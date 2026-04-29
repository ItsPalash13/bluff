package main

import (
	"fmt"
	"math/rand"
	"strings"
	"time"

	server "github.com/zishang520/socket.io/servers/socket/v3"
)

const (
	roomStatusSetup   = "setup"
	roomStatusInRound = "in_round"
	roomStatusGameEnd = "game_end"
)

var (
	deckRanks = []string{"A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3", "2"}
	deckSuits = []string{"S", "H", "D", "C"}
)

type Card struct {
	ID   string `json:"id"`
	Rank string `json:"rank"`
	Suit string `json:"suit"`
}

type BetState struct {
	Rank     string `json:"rank"`
	Count    int    `json:"count"`
	PlayerID string `json:"playerId"`
}

type GameState struct {
	RoomID           string
	Status           string
	TurnOrder        []string
	TurnIndex        int
	Hands            map[string][]Card
	Pile             []Card
	CurrentBet       *BetState
	FirstBetPlayerID string
	LastBetPlayerID  string
	LastPlayedCards  []Card
	PassCount        int
	FinishedPlayers  []string
	// PlayerNames is filled at game start from room users and kept for game_end
	// so rankings still show display names after players leave.
	PlayerNames       map[string]string
	CurrentTurnEndsAt time.Time
}

type departureOutcome string

const (
	departureNoEmit     departureOutcome = "no_emit"
	departureTurnUpdate departureOutcome = "turn_update"
	departureRoundReset departureOutcome = "round_reset"
	departureGameEnd    departureOutcome = "game_end"
)

type gamePlayBetPayload struct {
	CardIDs []string `json:"cardIds"`
	Rank    string   `json:"rank"`
	Count   int      `json:"count"`
}

func parseGamePlayBetPayload(args []any) gamePlayBetPayload {
	if len(args) == 0 {
		return gamePlayBetPayload{}
	}
	raw, ok := args[0].(map[string]any)
	if !ok {
		return gamePlayBetPayload{}
	}
	payload := gamePlayBetPayload{
		Rank: strings.ToUpper(strings.TrimSpace(stringFromJSON(raw["rank"]))),
	}
	payload.Count = intFromJSON(raw["count"])
	if cardsRaw, ok := raw["cardIds"].([]any); ok {
		payload.CardIDs = make([]string, 0, len(cardsRaw))
		for _, v := range cardsRaw {
			if s, ok := v.(string); ok && strings.TrimSpace(s) != "" {
				payload.CardIDs = append(payload.CardIDs, s)
			}
		}
	}
	return payload
}

func stringFromJSON(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

// turnDeadlineAfterNow sets the turn end time. If turnSeconds <= 0, there is no per-turn timeout;
// the deadline is far in the future so timeout logic in onTimerTick never fires.
func turnDeadlineAfterNow(turnSeconds int) time.Time {
	if turnSeconds <= 0 {
		return time.Now().Add(100 * 365 * 24 * time.Hour)
	}
	return time.Now().Add(time.Duration(turnSeconds) * time.Second)
}

func (s *roomStore) secondsLeftForClient(state *RoomState, game *GameState) int {
	if state.TurnSeconds <= 0 {
		return -1
	}
	sec := int(time.Until(game.CurrentTurnEndsAt).Seconds())
	if sec < 0 {
		return 0
	}
	return sec
}

func (s *roomStore) startGame(io *server.Server, socketID string, p roomStartPayload) (*RoomState, string, string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	roomID, ok := s.socketToRoom[socketID]
	if !ok {
		return nil, "ROOM_NOT_FOUND", "You are not in a room."
	}
	state, exists := s.rooms[roomID]
	if !exists {
		return nil, "ROOM_NOT_FOUND", "Room does not exist."
	}
	if state.HostSocketID != socketID {
		return nil, "NOT_HOST", "Only the host can start the room."
	}
	if state.Status != roomStatusWaiting {
		return nil, "INVALID_ROOM_STATUS", "Room has already started."
	}
	if !isAllowedTurnSeconds(p.TurnSeconds) {
		return nil, "INVALID_SETTINGS", "Invalid turn time."
	}
	if !isAllowedTotalCards(p.TotalCards) {
		return nil, "INVALID_SETTINGS", "Invalid total cards."
	}
	if len(state.Users) < minRoomCapacity {
		return nil, "INVALID_SETTINGS", "At least two players are required to start."
	}

	state.TurnSeconds = p.TurnSeconds
	state.TotalCards = p.TotalCards
	state.Status = roomStatusSetup
	io.To(server.Room(roomID)).Emit("setup_start", map[string]any{
		"roomId": roomID,
		"status": roomStatusSetup,
	})

	game := s.initializeGameLocked(state)
	state.Status = roomStatusInRound
	game.Status = roomStatusInRound
	s.games[roomID] = game

	s.startTimerLocked(io, state, game)
	s.emitGameStartLocked(io, state, game)
	s.emitTurnUpdateLocked(io, state, game)
	return cloneRoomState(state), "", ""
}

// restartRoom resets a finished room back to the waiting lobby with the currently
// connected users. Only the host may invoke it, and only while the room is in
// game_end. Settings (capacity / turnSeconds / totalCards) and the user list are
// preserved; the GameState is dropped and any active timer is stopped.
func (s *roomStore) restartRoom(io *server.Server, socketID string) (string, string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	roomID, ok := s.socketToRoom[socketID]
	if !ok {
		return "ROOM_NOT_FOUND", "You are not in a room."
	}
	state, exists := s.rooms[roomID]
	if !exists {
		return "ROOM_NOT_FOUND", "Room does not exist."
	}
	if state.HostSocketID != socketID {
		return "NOT_HOST", "Only the host can restart the room."
	}
	if state.Status != roomStatusGameEnd {
		return "INVALID_ROOM_STATUS", "Game has not ended yet."
	}

	s.stopTimerLocked(roomID)
	delete(s.games, roomID)
	state.Status = roomStatusWaiting

	io.To(server.Room(state.ID)).Emit("room:state", cloneRoomState(state))
	return "", ""
}

func (s *roomStore) initializeGameLocked(state *RoomState) *GameState {
	// Build full 52-card deck, shuffle, then take N (host totalCards) at random;
	// do not take a fixed prefix in rank/suit order before shuffling.
	deck := buildFullDeck()
	roomRng.Shuffle(len(deck), func(i, j int) {
		deck[i], deck[j] = deck[j], deck[i]
	})
	n := state.TotalCards
	if n > len(deck) {
		n = len(deck)
	}
	deck = deck[:n]

	turnOrder := make([]string, 0, len(state.Users))
	for _, user := range state.Users {
		turnOrder = append(turnOrder, user.PlayerID)
	}
	roomRng.Shuffle(len(turnOrder), func(i, j int) {
		turnOrder[i], turnOrder[j] = turnOrder[j], turnOrder[i]
	})

	hands := map[string][]Card{}
	for _, id := range turnOrder {
		hands[id] = []Card{}
	}
	for i, c := range deck {
		playerID := turnOrder[i%len(turnOrder)]
		hands[playerID] = append(hands[playerID], c)
	}

	playerNames := make(map[string]string, len(state.Users))
	for _, u := range state.Users {
		playerNames[u.PlayerID] = u.Name
	}

	return &GameState{
		RoomID:            state.ID,
		Status:            roomStatusInRound,
		TurnOrder:         turnOrder,
		TurnIndex:         0,
		Hands:             hands,
		Pile:              []Card{},
		CurrentBet:        nil,
		FirstBetPlayerID:  "",
		LastBetPlayerID:   "",
		LastPlayedCards:   nil,
		PassCount:         0,
		FinishedPlayers:   []string{},
		PlayerNames:       playerNames,
		CurrentTurnEndsAt: turnDeadlineAfterNow(state.TurnSeconds),
	}
}

func (s *roomStore) playBet(io *server.Server, socketID string, p gamePlayBetPayload) (string, string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	state, game, playerID, errCode, errMsg := s.getRoomAndGameBySocketLocked(socketID)
	if errCode != "" {
		return errCode, errMsg
	}
	if state.Status != roomStatusInRound || game.Status != roomStatusInRound {
		return "INVALID_ROOM_STATUS", "Game is not in progress."
	}
	if playerID != game.currentPlayerID() {
		return "NOT_TURN", "It is not your turn."
	}

	if len(p.CardIDs) == 0 || len(p.CardIDs) > 4 {
		return "INVALID_MOVE", "You must play between 1 and 4 cards."
	}
	if p.Count != len(p.CardIDs) {
		return "INVALID_MOVE", "Claim count must match played card count."
	}
	if !isValidRank(p.Rank) {
		return "INVALID_MOVE", "Invalid rank."
	}
	if game.CurrentBet != nil && p.Rank != game.CurrentBet.Rank {
		return "INVALID_MOVE", "You must continue with the same rank."
	}

	selectedCards, ok := extractCardsFromHand(game.Hands[playerID], p.CardIDs)
	if !ok {
		return "INVALID_MOVE", "You can only play cards from your hand."
	}
	game.Hands[playerID] = removeCardsByID(game.Hands[playerID], p.CardIDs)
	game.Pile = append(game.Pile, selectedCards...)
	game.LastPlayedCards = selectedCards

	previousLastBettor := game.LastBetPlayerID
	if game.CurrentBet == nil {
		game.FirstBetPlayerID = playerID
	}
	game.CurrentBet = &BetState{Rank: p.Rank, Count: p.Count, PlayerID: playerID}
	game.LastBetPlayerID = playerID
	game.PassCount = 0
	// A new valid bet resolves the previous last bettor's unresolved responsibility.
	s.recordIfFinishedLocked(game, previousLastBettor)
	s.recordIfFinishedLocked(game, playerID)
	if s.tryEndGameLocked(io, state, game) {
		return "", ""
	}

	io.To(server.Room(state.ID)).Emit("player_move", map[string]any{
		"playerId":  playerID,
		"rank":      p.Rank,
		"count":     p.Count,
		"pileCount": len(game.Pile),
	})

	s.moveToNextActiveLocked(game)
	s.resetTurnDeadlineLocked(state, game)
	s.emitTurnUpdateLocked(io, state, game)
	return "", ""
}

func (s *roomStore) passTurn(io *server.Server, socketID string, reason string) (string, string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	state, game, playerID, errCode, errMsg := s.getRoomAndGameBySocketLocked(socketID)
	if errCode != "" {
		return errCode, errMsg
	}
	if state.Status != roomStatusInRound || game.Status != roomStatusInRound {
		return "INVALID_ROOM_STATUS", "Game is not in progress."
	}
	if playerID != game.currentPlayerID() {
		return "NOT_TURN", "It is not your turn."
	}
	if game.CurrentBet == nil {
		return "INVALID_MOVE", "Cannot pass before the initial bet."
	}

	shouldFlush := playerID == game.LastBetPlayerID && game.PassCount >= s.activePlayerCountLocked(game)-1
	if shouldFlush {
		s.flushRoundLocked(io, state, game, playerID)
		return "", ""
	}

	game.PassCount++
	io.To(server.Room(state.ID)).Emit("player_pass", map[string]any{
		"playerId": playerID,
		"reason":   reason,
	})
	s.moveToNextActiveLocked(game)
	if s.tryAutoResolveZeroCardLastBettorLocked(io, state, game) {
		return "", ""
	}
	s.resetTurnDeadlineLocked(state, game)
	s.emitTurnUpdateLocked(io, state, game)
	return "", ""
}

// roomUserDisplayForBluff resolves name and character index for a socket from the live
// room user list, or from the game's name snapshot if they are no longer in Users.
func roomUserDisplayForBluff(state *RoomState, game *GameState, playerID string) (name string, characterIndex int) {
	for i := range state.Users {
		if state.Users[i].PlayerID == playerID {
			return state.Users[i].Name, state.Users[i].CharacterIndex
		}
	}
	if game != nil && game.PlayerNames != nil {
		if n, ok := game.PlayerNames[playerID]; ok && strings.TrimSpace(n) != "" {
			return strings.TrimSpace(n), 0
		}
	}
	return "Player", 0
}

func (s *roomStore) callBluff(io *server.Server, socketID string) (string, string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	state, game, callerID, errCode, errMsg := s.getRoomAndGameBySocketLocked(socketID)
	if errCode != "" {
		return errCode, errMsg
	}
	if state.Status != roomStatusInRound || game.Status != roomStatusInRound {
		return "INVALID_ROOM_STATUS", "Game is not in progress."
	}
	if game.CurrentBet == nil || game.LastBetPlayerID == "" {
		return "INVALID_MOVE", "No active bet to challenge."
	}
	if callerID == game.LastBetPlayerID {
		return "INVALID_MOVE", "You cannot call bluff on your own bet."
	}

	io.To(server.Room(state.ID)).Emit("bluff_called", map[string]any{
		"callerId": callerID,
		"targetId": game.LastBetPlayerID,
	})

	bluffCaught := false
	for _, card := range game.LastPlayedCards {
		if card.Rank != game.CurrentBet.Rank {
			bluffCaught = true
			break
		}
	}

	lastBettorID := game.LastBetPlayerID
	targetPlayerID := callerID
	if bluffCaught {
		targetPlayerID = lastBettorID
	}
	// Snapshot reveal data before resetRoundLocked clears LastPlayedCards / CurrentBet.
	revealCards := append([]Card(nil), game.LastPlayedCards...)
	claimedRank := game.CurrentBet.Rank
	claimedCount := game.CurrentBet.Count
	callerName, callerCharIdx := roomUserDisplayForBluff(state, game, callerID)
	targetName, targetCharIdx := roomUserDisplayForBluff(state, game, lastBettorID)
	game.Hands[targetPlayerID] = append(game.Hands[targetPlayerID], game.Pile...)
	io.To(server.Room(state.ID)).Emit("bluff_result", map[string]any{
		"callerId":             callerID,
		"targetId":             lastBettorID,
		"callerName":           callerName,
		"callerCharacterIndex": callerCharIdx,
		"targetName":           targetName,
		"targetCharacterIndex": targetCharIdx,
		"bluffCaught":          bluffCaught,
		"pileReceiver":         targetPlayerID,
		"lastPlayedCards":      revealCards,
		"claimedRank":          claimedRank,
		"claimedCount":         claimedCount,
	})

	// See docs/game-logic.md §9.2.1 + §9.2.4: clear round state first, sweep finished,
	// THEN pick the next starter from handed players only. The §5 anchor (caller on
	// bluff-true, last bettor on bluff-false) is preferred only if they still have
	// cards; otherwise we walk forward via nextHandedAfterLocked so a just-finished
	// player can never land on TurnIndex.
	s.resetRoundLocked(game, "")
	s.sweepFinishedLocked(game)

	desiredAnchor := lastBettorID
	if bluffCaught {
		desiredAnchor = callerID
	}
	var nextStarter string
	if len(game.Hands[desiredAnchor]) > 0 {
		nextStarter = desiredAnchor
	} else {
		nextStarter = s.nextHandedAfterLocked(game, desiredAnchor)
	}
	s.setTurnIndexToLocked(game, nextStarter)

	if s.tryEndGameLocked(io, state, game) {
		return "", ""
	}
	// Pause the per-turn timer during the reveal so onTimerTick does not auto-pass
	// the new starter while clients are still showing the reveal modal.
	game.CurrentTurnEndsAt = time.Now().Add(time.Hour)
	roomID := state.ID
	time.AfterFunc(openRevealHoldDuration, func() {
		s.finalizeOpenRevealAndStartRound(io, roomID)
	})
	return "", ""
}

const openRevealHoldDuration = 2500 * time.Millisecond

// finalizeOpenRevealAndStartRound is called once the post-Open reveal hold has elapsed.
// It re-acquires the store mutex, verifies the room/game are still live, resets the
// turn deadline for the new round and broadcasts a fresh turn_update so clients can
// dismiss the reveal modal and continue play.
func (s *roomStore) finalizeOpenRevealAndStartRound(io *server.Server, roomID string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	state, ok := s.rooms[roomID]
	if !ok {
		return
	}
	game, ok := s.games[roomID]
	if !ok {
		return
	}
	if state.Status != roomStatusInRound || game.Status != roomStatusInRound {
		return
	}
	s.resetTurnDeadlineLocked(state, game)
	s.emitTurnUpdateLocked(io, state, game)
}

func (s *roomStore) onTimerTick(io *server.Server, roomID string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	state, ok := s.rooms[roomID]
	if !ok {
		return
	}
	game, ok := s.games[roomID]
	if !ok || state.Status != roomStatusInRound || game.Status != roomStatusInRound {
		return
	}
	if state.TurnSeconds <= 0 {
		return
	}

	secondsLeft := int(time.Until(game.CurrentTurnEndsAt).Seconds())
	if secondsLeft < 0 {
		secondsLeft = 0
	}

	currentPlayerID := game.currentPlayerID()
	io.To(server.Room(roomID)).Emit("timer_tick", map[string]any{
		"playerId":    currentPlayerID,
		"secondsLeft": secondsLeft,
	})
	if secondsLeft > 0 {
		return
	}

	if game.CurrentBet == nil {
		s.moveToNextActiveLocked(game)
		s.resetTurnDeadlineLocked(state, game)
		s.emitTurnUpdateLocked(io, state, game)
		return
	}
	shouldFlush := currentPlayerID == game.LastBetPlayerID && game.PassCount >= s.activePlayerCountLocked(game)-1
	if shouldFlush {
		s.flushRoundLocked(io, state, game, currentPlayerID)
		return
	}
	game.PassCount++
	io.To(server.Room(roomID)).Emit("player_pass", map[string]any{
		"playerId": currentPlayerID,
		"reason":   "timeout",
	})
	s.moveToNextActiveLocked(game)
	if s.tryAutoResolveZeroCardLastBettorLocked(io, state, game) {
		return
	}
	s.resetTurnDeadlineLocked(state, game)
	s.emitTurnUpdateLocked(io, state, game)
}

func (s *roomStore) flushRoundLocked(io *server.Server, state *RoomState, game *GameState, byPlayerID string) {
	firstBettorID := game.FirstBetPlayerID
	io.To(server.Room(state.ID)).Emit("round_reset", map[string]any{
		"reason": "pass_flush",
		"by":     byPlayerID,
	})
	// Order matters (see docs/game-logic.md §9.2.4): clear round state first so the
	// just-resolved 0-card last bettor (and any other 0-card players) become eligible
	// to be marked finished, then sweep finished BEFORE picking the next starter so
	// a finished player can never land on TurnIndex.
	s.resetRoundLocked(game, "")
	s.sweepFinishedLocked(game)
	nextStarter := s.nextHandedAfterLocked(game, firstBettorID)
	s.setTurnIndexToLocked(game, nextStarter)
	if s.tryEndGameLocked(io, state, game) {
		return
	}
	s.resetTurnDeadlineLocked(state, game)
	s.emitTurnUpdateLocked(io, state, game)
}

func (s *roomStore) tryAutoResolveZeroCardLastBettorLocked(io *server.Server, state *RoomState, game *GameState) bool {
	if game.CurrentBet == nil || game.LastBetPlayerID == "" {
		return false
	}
	currentPlayerID := game.currentPlayerID()
	if currentPlayerID == "" || currentPlayerID != game.LastBetPlayerID {
		return false
	}
	if len(game.Hands[currentPlayerID]) != 0 {
		return false
	}
	requiredPasses := s.activePlayerCountLocked(game) - 1
	if requiredPasses < 0 {
		requiredPasses = 0
	}
	if game.PassCount < requiredPasses {
		return false
	}
	io.To(server.Room(state.ID)).Emit("player_pass", map[string]any{
		"playerId": currentPlayerID,
		"reason":   "auto_no_cards",
	})
	s.flushRoundLocked(io, state, game, currentPlayerID)
	return true
}

func (s *roomStore) resetRoundLocked(game *GameState, starterID string) {
	game.Pile = []Card{}
	game.CurrentBet = nil
	game.PassCount = 0
	game.FirstBetPlayerID = ""
	game.LastBetPlayerID = ""
	game.LastPlayedCards = nil
	if starterID != "" {
		for idx, id := range game.TurnOrder {
			if id == starterID {
				game.TurnIndex = idx
				return
			}
		}
	}
}

func (s *roomStore) emitGameStartLocked(io *server.Server, state *RoomState, game *GameState) {
	io.To(server.Room(state.ID)).Emit("game_start", map[string]any{
		"roomId":      state.ID,
		"turnOrder":   append([]string(nil), game.TurnOrder...),
		"turnSeconds": state.TurnSeconds,
		"status":      roomStatusInRound,
	})
}

func (s *roomStore) emitTurnUpdateLocked(io *server.Server, state *RoomState, game *GameState) {
	base := map[string]any{
		"roomId":           state.ID,
		"status":           game.Status,
		"currentPlayerId":  game.currentPlayerID(),
		"secondsLeft":      s.secondsLeftForClient(state, game),
		"currentBet":       game.CurrentBet,
		"pileCount":        len(game.Pile),
		"lastBetPlayerId":  game.LastBetPlayerID,
		"firstBetPlayerId": game.FirstBetPlayerID,
		"passCount":        game.PassCount,
		"finishedPlayers":  append([]string(nil), game.FinishedPlayers...),
		"playerCardCounts": s.playerCardCountsLocked(game),
	}
	for _, user := range state.Users {
		if !user.Connected || strings.TrimSpace(user.SocketID) == "" {
			continue
		}
		payload := map[string]any{}
		for k, v := range base {
			payload[k] = v
		}
		payload["yourPlayerId"] = user.PlayerID
		payload["yourHand"] = append([]Card(nil), game.Hands[user.PlayerID]...)
		io.To(server.Room(user.SocketID)).Emit("turn_update", payload)
	}
}

func (s *roomStore) emitDepartureOutcomeLocked(
	io *server.Server,
	state *RoomState,
	game *GameState,
	outcome departureOutcome,
	departedSocketID string,
	reason string,
) {
	switch outcome {
	case departureRoundReset:
		io.To(server.Room(state.ID)).Emit("round_reset", map[string]any{
			"reason":   reason,
			"departed": departedSocketID,
		})
		s.emitTurnUpdateLocked(io, state, game)
	case departureTurnUpdate:
		s.emitTurnUpdateLocked(io, state, game)
	case departureGameEnd:
		// already emitted inside tryEndGameLocked
	default:
	}
}

func (s *roomStore) handlePlayerDepartureLocked(
	io *server.Server,
	state *RoomState,
	game *GameState,
	departedSocketID string,
	wasCurrentTurn bool,
	wasLastBettor bool,
) departureOutcome {
	if game == nil || state == nil {
		return departureNoEmit
	}
	if game.Status != roomStatusInRound || state.Status != roomStatusInRound {
		return departureNoEmit
	}

	// Keep turn index in bounds after removal.
	if len(game.TurnOrder) == 0 {
		return departureNoEmit
	}
	if game.TurnIndex < 0 || game.TurnIndex >= len(game.TurnOrder) {
		game.TurnIndex = 0
	}

	activeCount := s.activePlayerCountLocked(game)
	if activeCount <= 1 {
		if s.tryEndGameLocked(io, state, game) {
			return departureGameEnd
		}
		return departureNoEmit
	}

	// If round hasn't started with first bet yet, terminate and restart clean.
	// See docs/game-logic.md §9.2.4: starter selection at round boundaries must
	// require Hands>0 so a 0-card unresolved-bet player is never left on TurnIndex.
	if game.CurrentBet == nil {
		s.resetRoundLocked(game, "")
		s.sweepFinishedLocked(game)
		nextStarter := s.nextHandedAfterLocked(game, departedSocketID)
		s.setTurnIndexToLocked(game, nextStarter)
		if s.tryEndGameLocked(io, state, game) {
			return departureGameEnd
		}
		s.resetTurnDeadlineLocked(state, game)
		return departureRoundReset
	}

	// Last bettor left before loop completion => terminate current round.
	if wasLastBettor {
		s.resetRoundLocked(game, "")
		s.sweepFinishedLocked(game)
		nextStarter := s.nextHandedAfterLocked(game, departedSocketID)
		s.setTurnIndexToLocked(game, nextStarter)
		if s.tryEndGameLocked(io, state, game) {
			return departureGameEnd
		}
		s.resetTurnDeadlineLocked(state, game)
		return departureRoundReset
	}

	// If leaver was current player in active round, skip turn to next player.
	if wasCurrentTurn {
		if len(game.TurnOrder) > 0 && len(game.Hands[game.currentPlayerID()]) == 0 {
			s.moveToNextActiveLocked(game)
		}
		s.resetTurnDeadlineLocked(state, game)
		return departureTurnUpdate
	}

	// Keep pointers consistent if they referenced departed player.
	if game.FirstBetPlayerID == departedSocketID {
		game.FirstBetPlayerID = s.nextActiveAfterLocked(game, departedSocketID)
	}
	if game.LastBetPlayerID == departedSocketID {
		game.LastBetPlayerID = ""
	}
	maxPass := activeCount - 1
	if maxPass < 0 {
		maxPass = 0
	}
	if game.PassCount > maxPass {
		game.PassCount = maxPass
	}
	return departureTurnUpdate
}

func (s *roomStore) tryEndGameLocked(io *server.Server, state *RoomState, game *GameState) bool {
	if s.activePlayerCountLocked(game) > 1 {
		return false
	}
	last := ""
	for _, id := range game.TurnOrder {
		if len(game.Hands[id]) > 0 {
			last = id
			break
		}
	}
	if last != "" && !containsString(game.FinishedPlayers, last) {
		game.FinishedPlayers = append(game.FinishedPlayers, last)
	}
	game.Status = roomStatusGameEnd
	state.Status = roomStatusGameEnd
	s.stopTimerLocked(state.ID)
	playerNames := map[string]any{}
	for k, v := range game.PlayerNames {
		playerNames[k] = v
	}
	io.To(server.Room(state.ID)).Emit("game_end", map[string]any{
		"roomId":           state.ID,
		"finishedPlayers":  append([]string(nil), game.FinishedPlayers...),
		"playerNames":      playerNames,
		"playerCardCounts": s.playerCardCountsLocked(game),
	})
	return true
}

func (s *roomStore) recordIfFinishedLocked(game *GameState, playerID string) {
	if playerID == "" {
		return
	}
	// A zero-card last bettor is still active until that bet is resolved.
	if game.CurrentBet != nil && game.LastBetPlayerID == playerID {
		return
	}
	if len(game.Hands[playerID]) != 0 {
		return
	}
	if containsString(game.FinishedPlayers, playerID) {
		return
	}
	game.FinishedPlayers = append(game.FinishedPlayers, playerID)
}

func (s *roomStore) playerCardCountsLocked(game *GameState) map[string]int {
	out := map[string]int{}
	for _, id := range game.TurnOrder {
		out[id] = len(game.Hands[id])
	}
	return out
}

func (s *roomStore) getRoomAndGameBySocketLocked(socketID string) (*RoomState, *GameState, string, string, string) {
	roomID, ok := s.socketToRoom[socketID]
	if !ok {
		return nil, nil, "", "ROOM_NOT_FOUND", "You are not in a room."
	}
	playerID, ok := s.socketToUser[socketID]
	if !ok || playerID == "" {
		return nil, nil, "", "ROOM_NOT_FOUND", "You are not in a room."
	}
	state, ok := s.rooms[roomID]
	if !ok {
		return nil, nil, "", "ROOM_NOT_FOUND", "Room does not exist."
	}
	game, ok := s.games[roomID]
	if !ok {
		return nil, nil, "", "ROOM_NOT_FOUND", "Game has not started yet."
	}
	return state, game, playerID, "", ""
}

func (s *roomStore) activePlayerCountLocked(game *GameState) int {
	count := 0
	for _, id := range game.TurnOrder {
		if s.isActiveForRoundLocked(game, id) {
			count++
		}
	}
	return count
}

func (s *roomStore) currentPlayerHasCardsLocked(game *GameState) bool {
	playerID := game.currentPlayerID()
	return s.isActiveForRoundLocked(game, playerID)
}

func (g *GameState) currentPlayerID() string {
	if len(g.TurnOrder) == 0 {
		return ""
	}
	if g.TurnIndex < 0 {
		g.TurnIndex = 0
	}
	g.TurnIndex %= len(g.TurnOrder)
	return g.TurnOrder[g.TurnIndex]
}

func (s *roomStore) moveToNextActiveLocked(game *GameState) {
	if len(game.TurnOrder) == 0 {
		return
	}
	for i := 0; i < len(game.TurnOrder); i++ {
		game.TurnIndex = (game.TurnIndex + 1) % len(game.TurnOrder)
		if s.currentPlayerHasCardsLocked(game) {
			return
		}
	}
}

func (s *roomStore) nextActiveAfterLocked(game *GameState, playerID string) string {
	if len(game.TurnOrder) == 0 {
		return ""
	}
	start := -1
	for i, id := range game.TurnOrder {
		if id == playerID {
			start = i
			break
		}
	}
	if start == -1 {
		return game.currentPlayerID()
	}
	idx := start
	for i := 0; i < len(game.TurnOrder); i++ {
		idx = (idx + 1) % len(game.TurnOrder)
		nextID := game.TurnOrder[idx]
		if s.isActiveForRoundLocked(game, nextID) {
			return nextID
		}
	}
	return game.currentPlayerID()
}

func (s *roomStore) isActiveForRoundLocked(game *GameState, playerID string) bool {
	if playerID == "" {
		return false
	}
	if len(game.Hands[playerID]) > 0 {
		return true
	}
	return game.CurrentBet != nil && game.LastBetPlayerID == playerID
}

// nextHandedAfterLocked returns the next player after anchorID in turn order whose
// Hands has cards (strictly len > 0). Unlike nextActiveAfterLocked, this helper does
// NOT exempt the unresolved-bet last bettor, so it is the correct choice for
// round-boundary starter selection (after the previous bet has been resolved).
// Returns "" if no eligible player exists.
func (s *roomStore) nextHandedAfterLocked(game *GameState, anchorID string) string {
	if len(game.TurnOrder) == 0 {
		return ""
	}
	start := -1
	for i, id := range game.TurnOrder {
		if id == anchorID {
			start = i
			break
		}
	}
	if start == -1 {
		// Anchor not in turn order (e.g. already-departed player). Fall back to
		// scanning forward from the current TurnIndex so we still walk the full ring.
		start = game.TurnIndex - 1
		if start < 0 {
			start = len(game.TurnOrder) - 1
		}
	}
	idx := start
	for i := 0; i < len(game.TurnOrder); i++ {
		idx = (idx + 1) % len(game.TurnOrder)
		nextID := game.TurnOrder[idx]
		if len(game.Hands[nextID]) > 0 {
			return nextID
		}
	}
	return ""
}

// setTurnIndexToLocked positions TurnIndex on playerID. No-op if playerID is empty
// or not present in TurnOrder.
func (s *roomStore) setTurnIndexToLocked(game *GameState, playerID string) {
	if playerID == "" {
		return
	}
	for idx, id := range game.TurnOrder {
		if id == playerID {
			game.TurnIndex = idx
			return
		}
	}
}

// sweepFinishedLocked records every TurnOrder player whose hand is currently empty
// as finished (in turn-order traversal order). The unresolved-bet guard inside
// recordIfFinishedLocked still protects an active last bettor when CurrentBet != nil,
// so this is safe to call any time and ideal immediately after resetRoundLocked("").
func (s *roomStore) sweepFinishedLocked(game *GameState) {
	for _, id := range game.TurnOrder {
		s.recordIfFinishedLocked(game, id)
	}
}

func (s *roomStore) resetTurnDeadlineLocked(state *RoomState, game *GameState) {
	game.CurrentTurnEndsAt = turnDeadlineAfterNow(state.TurnSeconds)
}

func (s *roomStore) startTimerLocked(io *server.Server, state *RoomState, game *GameState) {
	s.stopTimerLocked(state.ID)
	game.CurrentTurnEndsAt = turnDeadlineAfterNow(state.TurnSeconds)
	if state.TurnSeconds <= 0 {
		return
	}
	stopCh := make(chan struct{})
	s.turnTimers[state.ID] = stopCh
	go func(roomID string, stop <-chan struct{}) {
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				s.onTimerTick(io, roomID)
			case <-stop:
				return
			}
		}
	}(state.ID, stopCh)
}

func (s *roomStore) stopTimerLocked(roomID string) {
	if stopCh, ok := s.turnTimers[roomID]; ok {
		close(stopCh)
		delete(s.turnTimers, roomID)
	}
}

func buildFullDeck() []Card {
	deck := make([]Card, 0, len(deckRanks)*len(deckSuits))
	for _, rank := range deckRanks {
		for _, suit := range deckSuits {
			deck = append(deck, Card{
				ID:   fmt.Sprintf("%s-%s-%d", rank, suit, rand.Int63()),
				Rank: rank,
				Suit: suit,
			})
		}
	}
	return deck
}

func extractCardsFromHand(hand []Card, cardIDs []string) ([]Card, bool) {
	want := map[string]int{}
	for _, id := range cardIDs {
		want[id]++
	}
	selected := make([]Card, 0, len(cardIDs))
	for _, card := range hand {
		if count, ok := want[card.ID]; ok && count > 0 {
			selected = append(selected, card)
			want[card.ID]--
		}
	}
	if len(selected) != len(cardIDs) {
		return nil, false
	}
	return selected, true
}

func removeCardsByID(hand []Card, cardIDs []string) []Card {
	want := map[string]int{}
	for _, id := range cardIDs {
		want[id]++
	}
	next := make([]Card, 0, len(hand)-len(cardIDs))
	for _, card := range hand {
		if count, ok := want[card.ID]; ok && count > 0 {
			want[card.ID]--
			continue
		}
		next = append(next, card)
	}
	return next
}

func containsString(items []string, needle string) bool {
	for _, item := range items {
		if item == needle {
			return true
		}
	}
	return false
}

func isValidRank(rank string) bool {
	for _, r := range deckRanks {
		if r == rank {
			return true
		}
	}
	return false
}
