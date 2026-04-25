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
	RoomID            string
	Status            string
	TurnOrder         []string
	TurnIndex         int
	Hands             map[string][]Card
	Pile              []Card
	CurrentBet        *BetState
	FirstBetPlayerID  string
	LastBetPlayerID   string
	LastPlayedCards   []Card
	PassCount         int
	FinishedPlayers   []string
	CurrentTurnEndsAt time.Time
}

type departureOutcome string

const (
	departureNoEmit      departureOutcome = "no_emit"
	departureTurnUpdate  departureOutcome = "turn_update"
	departureRoundReset  departureOutcome = "round_reset"
	departureGameEnd     departureOutcome = "game_end"
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

func (s *roomStore) initializeGameLocked(state *RoomState) *GameState {
	deck := buildDeck(state.TotalCards)
	roomRng.Shuffle(len(deck), func(i, j int) {
		deck[i], deck[j] = deck[j], deck[i]
	})

	turnOrder := make([]string, 0, len(state.Users))
	for _, user := range state.Users {
		turnOrder = append(turnOrder, user.SocketID)
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
		CurrentTurnEndsAt: time.Now().Add(time.Duration(state.TurnSeconds) * time.Second),
	}
}

func (s *roomStore) playBet(io *server.Server, socketID string, p gamePlayBetPayload) (string, string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	state, game, errCode, errMsg := s.getRoomAndGameBySocketLocked(socketID)
	if errCode != "" {
		return errCode, errMsg
	}
	if state.Status != roomStatusInRound || game.Status != roomStatusInRound {
		return "INVALID_ROOM_STATUS", "Game is not in progress."
	}
	if socketID != game.currentPlayerID() {
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

	selectedCards, ok := extractCardsFromHand(game.Hands[socketID], p.CardIDs)
	if !ok {
		return "INVALID_MOVE", "You can only play cards from your hand."
	}
	game.Hands[socketID] = removeCardsByID(game.Hands[socketID], p.CardIDs)
	game.Pile = append(game.Pile, selectedCards...)
	game.LastPlayedCards = selectedCards

	previousLastBettor := game.LastBetPlayerID
	if game.CurrentBet == nil {
		game.FirstBetPlayerID = socketID
	}
	game.CurrentBet = &BetState{Rank: p.Rank, Count: p.Count, PlayerID: socketID}
	game.LastBetPlayerID = socketID
	game.PassCount = 0
	// A new valid bet resolves the previous last bettor's unresolved responsibility.
	s.recordIfFinishedLocked(game, previousLastBettor)
	s.recordIfFinishedLocked(game, socketID)
	if s.tryEndGameLocked(io, state, game) {
		return "", ""
	}

	io.To(server.Room(state.ID)).Emit("player_move", map[string]any{
		"playerId": socketID,
		"rank":     p.Rank,
		"count":    p.Count,
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

	state, game, errCode, errMsg := s.getRoomAndGameBySocketLocked(socketID)
	if errCode != "" {
		return errCode, errMsg
	}
	if state.Status != roomStatusInRound || game.Status != roomStatusInRound {
		return "INVALID_ROOM_STATUS", "Game is not in progress."
	}
	if socketID != game.currentPlayerID() {
		return "NOT_TURN", "It is not your turn."
	}
	if game.CurrentBet == nil {
		return "INVALID_MOVE", "Cannot pass before the initial bet."
	}

	shouldFlush := socketID == game.LastBetPlayerID && game.PassCount >= s.activePlayerCountLocked(game)-1
	if shouldFlush {
		s.flushRoundLocked(io, state, game, socketID)
		return "", ""
	}

	game.PassCount++
	io.To(server.Room(state.ID)).Emit("player_pass", map[string]any{
		"playerId": socketID,
		"reason":   reason,
	})
	s.moveToNextActiveLocked(game)
	s.resetTurnDeadlineLocked(state, game)
	s.emitTurnUpdateLocked(io, state, game)
	return "", ""
}

func (s *roomStore) callBluff(io *server.Server, socketID string) (string, string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	state, game, errCode, errMsg := s.getRoomAndGameBySocketLocked(socketID)
	if errCode != "" {
		return errCode, errMsg
	}
	if state.Status != roomStatusInRound || game.Status != roomStatusInRound {
		return "INVALID_ROOM_STATUS", "Game is not in progress."
	}
	if game.CurrentBet == nil || game.LastBetPlayerID == "" {
		return "INVALID_MOVE", "No active bet to challenge."
	}
	if socketID == game.LastBetPlayerID {
		return "INVALID_MOVE", "You cannot call bluff on your own bet."
	}

	io.To(server.Room(state.ID)).Emit("bluff_called", map[string]any{
		"callerId": socketID,
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
	targetPlayerID := socketID
	nextStarterID := lastBettorID
	if bluffCaught {
		targetPlayerID = lastBettorID
		nextStarterID = socketID
	}
	game.Hands[targetPlayerID] = append(game.Hands[targetPlayerID], game.Pile...)
	io.To(server.Room(state.ID)).Emit("bluff_result", map[string]any{
		"callerId":     socketID,
		"targetId":     lastBettorID,
		"bluffCaught":  bluffCaught,
		"pileReceiver": targetPlayerID,
	})

	s.resetRoundLocked(game, nextStarterID)
	// Bluff resolution resolves the previous last bet.
	s.recordIfFinishedLocked(game, lastBettorID)
	s.recordIfFinishedLocked(game, socketID)
	s.recordIfFinishedLocked(game, targetPlayerID)
	if s.tryEndGameLocked(io, state, game) {
		return "", ""
	}
	s.resetTurnDeadlineLocked(state, game)
	s.emitTurnUpdateLocked(io, state, game)
	return "", ""
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
	s.resetTurnDeadlineLocked(state, game)
	s.emitTurnUpdateLocked(io, state, game)
}

func (s *roomStore) flushRoundLocked(io *server.Server, state *RoomState, game *GameState, byPlayerID string) {
	lastBettorID := game.LastBetPlayerID
	io.To(server.Room(state.ID)).Emit("round_reset", map[string]any{
		"reason": "pass_flush",
		"by":     byPlayerID,
	})
	nextStarter := s.nextActiveAfterLocked(game, game.FirstBetPlayerID)
	s.resetRoundLocked(game, nextStarter)
	// Flush resolves the last unresolved bet.
	s.recordIfFinishedLocked(game, lastBettorID)
	if s.tryEndGameLocked(io, state, game) {
		return
	}
	s.resetTurnDeadlineLocked(state, game)
	s.emitTurnUpdateLocked(io, state, game)
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
		"roomId":     state.ID,
		"turnOrder":  append([]string(nil), game.TurnOrder...),
		"turnSeconds": state.TurnSeconds,
		"status":     roomStatusInRound,
	})
}

func (s *roomStore) emitTurnUpdateLocked(io *server.Server, state *RoomState, game *GameState) {
	base := map[string]any{
		"roomId":            state.ID,
		"status":            game.Status,
		"currentPlayerId":   game.currentPlayerID(),
		"secondsLeft":       int(time.Until(game.CurrentTurnEndsAt).Seconds()),
		"currentBet":        game.CurrentBet,
		"pileCount":         len(game.Pile),
		"lastBetPlayerId":   game.LastBetPlayerID,
		"firstBetPlayerId":  game.FirstBetPlayerID,
		"passCount":         game.PassCount,
		"finishedPlayers":   append([]string(nil), game.FinishedPlayers...),
		"playerCardCounts":  s.playerCardCountsLocked(game),
	}
	for _, user := range state.Users {
		payload := map[string]any{}
		for k, v := range base {
			payload[k] = v
		}
		payload["yourPlayerId"] = user.SocketID
		payload["yourHand"] = append([]Card(nil), game.Hands[user.SocketID]...)
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
	if game.CurrentBet == nil {
		nextStarter := game.currentPlayerID()
		if nextStarter == "" || len(game.Hands[nextStarter]) == 0 {
			nextStarter = s.nextActiveAfterLocked(game, departedSocketID)
		}
		s.resetRoundLocked(game, nextStarter)
		s.resetTurnDeadlineLocked(state, game)
		return departureRoundReset
	}

	// Last bettor left before loop completion => terminate current round.
	if wasLastBettor {
		nextStarter := s.nextActiveAfterLocked(game, departedSocketID)
		s.resetRoundLocked(game, nextStarter)
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
	io.To(server.Room(state.ID)).Emit("game_end", map[string]any{
		"roomId":           state.ID,
		"finishedPlayers":  append([]string(nil), game.FinishedPlayers...),
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

func (s *roomStore) getRoomAndGameBySocketLocked(socketID string) (*RoomState, *GameState, string, string) {
	roomID, ok := s.socketToRoom[socketID]
	if !ok {
		return nil, nil, "ROOM_NOT_FOUND", "You are not in a room."
	}
	state, ok := s.rooms[roomID]
	if !ok {
		return nil, nil, "ROOM_NOT_FOUND", "Room does not exist."
	}
	game, ok := s.games[roomID]
	if !ok {
		return nil, nil, "ROOM_NOT_FOUND", "Game has not started yet."
	}
	return state, game, "", ""
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

func (s *roomStore) resetTurnDeadlineLocked(state *RoomState, game *GameState) {
	game.CurrentTurnEndsAt = time.Now().Add(time.Duration(state.TurnSeconds) * time.Second)
}

func (s *roomStore) startTimerLocked(io *server.Server, state *RoomState, game *GameState) {
	s.stopTimerLocked(state.ID)
	stopCh := make(chan struct{})
	s.turnTimers[state.ID] = stopCh
	game.CurrentTurnEndsAt = time.Now().Add(time.Duration(state.TurnSeconds) * time.Second)
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

func buildDeck(totalCards int) []Card {
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
	if totalCards > len(deck) {
		totalCards = len(deck)
	}
	return deck[:totalCards]
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
