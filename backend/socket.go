package main

import (
	"fmt"
	"math/rand"
	"strings"
	"sync"
	"time"

	server "github.com/zishang520/socket.io/servers/socket/v3"
	"github.com/zishang520/socket.io/v3/pkg/types"
)

const (
	roomCodeLength    = 6
	minRoomCapacity   = 2 // min players to start a game (see game_runtime)
	fixedRoomCapacity = 6 // lobby join slots; not configurable
	roomStatusWaiting  = "waiting"
	roomStatusStarted  = "started"
)

var (
	roomCodeCharset = []rune("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
	roomRng         = rand.New(rand.NewSource(time.Now().UnixNano()))
)

type RoomUser struct {
	SocketID       string `json:"socketId"`
	Name           string `json:"name"`
	CharacterIndex int    `json:"characterIndex"`
}

type RoomState struct {
	ID           string     `json:"id"`
	HostSocketID string     `json:"hostSocketId"`
	Capacity     int        `json:"capacity"`
	Status       string     `json:"status"`
	TurnSeconds  int        `json:"turnSeconds"`
	TotalCards   int        `json:"totalCards"`
	Users        []RoomUser `json:"users"`
}

type roomPayload struct {
	Name           string `json:"name"`
	CharacterIndex int    `json:"characterIndex"`
	RoomID         string `json:"roomId"`
}

type roomMessagePayload struct {
	Message string `json:"message"`
}

type roomSettingsPayload struct {
	TurnSeconds int `json:"turnSeconds"`
	TotalCards  int `json:"totalCards"`
}

type roomStartPayload struct {
	TurnSeconds int `json:"turnSeconds"`
	TotalCards  int `json:"totalCards"`
}

type roomStore struct {
	mu           sync.Mutex
	rooms        map[string]*RoomState
	socketToRoom map[string]string
	games        map[string]*GameState
	turnTimers   map[string]chan struct{}
}

func newRoomStore() *roomStore {
	return &roomStore{
		rooms:        map[string]*RoomState{},
		socketToRoom: map[string]string{},
		games:        map[string]*GameState{},
		turnTimers:   map[string]chan struct{}{},
	}
}

func newSocketServer() *server.Server {
	opts := server.DefaultServerOptions()
	opts.SetCors(&types.Cors{
		Origin: []any{
			"http://localhost:5173",
			"http://127.0.0.1:5173",
		},
		Methods:     []string{"GET", "POST"},
		Credentials: true,
	})

	io := server.NewServer(nil, opts)
	store := newRoomStore()

	io.On("connection", func(args ...any) {
		socket := args[0].(*server.Socket)
		socketID := string(socket.Id())
		fmt.Printf("client connected: %s\n", socketID)

		socket.On("room:create", func(args ...any) {
			payload := parseRoomPayload(args)
			fmt.Printf("[socket] room:create from=%s name=%q characterIndex=%d\n", socketID, payload.Name, payload.CharacterIndex)
			if !isValidName(payload.Name) {
				fmt.Printf("[socket] room:create rejected socket=%s reason=INVALID_NAME\n", socketID)
				socket.Emit("room:error", map[string]any{
					"code":    "INVALID_NAME",
					"message": "Name is required to create a room.",
				})
				return
			}

			state := store.createRoom(socketID, payload.Name, payload.CharacterIndex)
			fmt.Printf("[socket] room:create success socket=%s room=%s users=%d\n", socketID, state.ID, len(state.Users))
			socket.Join(server.Room(state.ID))
			socket.Emit("room:created", state)
			emitRoomState(io, state)
		})

		socket.On("room:join", func(args ...any) {
			payload := parseRoomPayload(args)
			fmt.Printf("[socket] room:join from=%s room=%q name=%q characterIndex=%d\n", socketID, payload.RoomID, payload.Name, payload.CharacterIndex)
			if !isValidName(payload.Name) {
				fmt.Printf("[socket] room:join rejected socket=%s room=%q reason=INVALID_NAME\n", socketID, payload.RoomID)
				socket.Emit("room:error", map[string]any{
					"code":    "INVALID_NAME",
					"message": "Name is required to join a room.",
				})
				return
			}

			state, errCode, errMsg := store.joinRoom(socketID, payload.RoomID, payload.Name, payload.CharacterIndex)
			if errCode != "" {
				fmt.Printf("[socket] room:join rejected socket=%s room=%q code=%s message=%q\n", socketID, payload.RoomID, errCode, errMsg)
				socket.Emit("room:error", map[string]any{
					"code":    errCode,
					"message": errMsg,
				})
				return
			}

			fmt.Printf("[socket] room:join success socket=%s room=%s users=%d\n", socketID, state.ID, len(state.Users))
			socket.Join(server.Room(state.ID))
			socket.Emit("room:joined", state)
			emitRoomState(io, state)
		})

		socket.On("room:leave", func(args ...any) {
			fmt.Printf("[socket] room:leave from=%s\n", socketID)
			state, previousRoomID := store.leaveRoom(io, socketID)
			if previousRoomID != "" {
				fmt.Printf("[socket] room:leave success socket=%s room=%s\n", socketID, previousRoomID)
				socket.Leave(server.Room(previousRoomID))
			}
			if state != nil {
				emitRoomState(io, state)
			}
		})

		socket.On("room:message", func(args ...any) {
			payload := parseRoomMessagePayload(args)
			message := strings.TrimSpace(payload.Message)
			if message == "" {
				return
			}

			roomID, senderName, ok := store.getSocketRoomAndName(socketID)
			if !ok {
				socket.Emit("room:error", map[string]any{
					"code":    "ROOM_NOT_FOUND",
					"message": "Cannot send message outside an active room.",
				})
				return
			}

			msg := map[string]any{
				"socketId": socketID,
				"name":     senderName,
				"message":  message,
				"sentAt":   time.Now().UnixMilli(),
			}
			fmt.Printf("[socket] room:message room=%s socket=%s name=%q message=%q\n", roomID, socketID, senderName, message)
			io.To(server.Room(roomID)).Emit("room:message", msg)
		})

		socket.On("room:updateSettings", func(args ...any) {
			payload := parseRoomSettingsPayload(args)
			fmt.Printf("[socket] room:updateSettings from=%s turnSeconds=%d totalCards=%d\n",
				socketID, payload.TurnSeconds, payload.TotalCards)
			state, errCode, errMsg := store.updateRoomSettings(socketID, payload)
			if errCode != "" {
				fmt.Printf("[socket] room:updateSettings rejected socket=%s code=%s message=%q\n", socketID, errCode, errMsg)
				socket.Emit("room:error", map[string]any{
					"code":    errCode,
					"message": errMsg,
				})
				return
			}
			if state != nil {
				emitRoomState(io, state)
			}
		})

		socket.On("room:start", func(args ...any) {
			payload := parseRoomStartPayload(args)
			fmt.Printf("[socket] room:start from=%s turnSeconds=%d totalCards=%d\n",
				socketID, payload.TurnSeconds, payload.TotalCards)
			state, errCode, errMsg := store.startGame(io, socketID, payload)
			if errCode != "" {
				fmt.Printf("[socket] room:start rejected socket=%s code=%s message=%q\n", socketID, errCode, errMsg)
				socket.Emit("room:error", map[string]any{
					"code":    errCode,
					"message": errMsg,
				})
				return
			}
			if state != nil {
				emitRoomState(io, state)
			}
		})

		socket.On("game:play_bet", func(args ...any) {
			payload := parseGamePlayBetPayload(args)
			if errCode, errMsg := store.playBet(io, socketID, payload); errCode != "" {
				socket.Emit("room:error", map[string]any{
					"code":    errCode,
					"message": errMsg,
				})
			}
		})

		socket.On("game:pass", func(args ...any) {
			if errCode, errMsg := store.passTurn(io, socketID, "manual"); errCode != "" {
				socket.Emit("room:error", map[string]any{
					"code":    errCode,
					"message": errMsg,
				})
			}
		})

		socket.On("game:call_bluff", func(args ...any) {
			if errCode, errMsg := store.callBluff(io, socketID); errCode != "" {
				socket.Emit("room:error", map[string]any{
					"code":    errCode,
					"message": errMsg,
				})
			}
		})

		socket.On("disconnect", func(args ...any) {
			reason := ""
			if len(args) > 0 {
				if value, ok := args[0].(string); ok {
					reason = value
				} else {
					reason = fmt.Sprint(args[0])
				}
			}
			fmt.Printf("client disconnected: %s reason=%s\n", socketID, reason)
			state, _ := store.leaveRoom(io, socketID)
			if state != nil {
				emitRoomState(io, state)
			}
		})
	})

	return io
}

func emitRoomState(io *server.Server, state *RoomState) {
	fmt.Printf("[socket] emit room:state room=%s users=%d host=%s\n", state.ID, len(state.Users), state.HostSocketID)
	io.To(server.Room(state.ID)).Emit("room:state", state)
}

func isValidName(value string) bool {
	return len(value) > 0
}

func parseRoomPayload(args []any) roomPayload {
	if len(args) == 0 {
		return roomPayload{}
	}

	raw, ok := args[0].(map[string]any)
	if !ok {
		return roomPayload{}
	}

	payload := roomPayload{}
	if name, ok := raw["name"].(string); ok {
		payload.Name = name
	}
	if roomID, ok := raw["roomId"].(string); ok {
		payload.RoomID = roomID
	}
	if characterIndex, ok := raw["characterIndex"].(float64); ok {
		payload.CharacterIndex = int(characterIndex)
	}
	return payload
}

func parseRoomMessagePayload(args []any) roomMessagePayload {
	if len(args) == 0 {
		return roomMessagePayload{}
	}

	raw, ok := args[0].(map[string]any)
	if !ok {
		return roomMessagePayload{}
	}

	payload := roomMessagePayload{}
	if message, ok := raw["message"].(string); ok {
		payload.Message = message
	}
	return payload
}

func parseRoomSettingsPayload(args []any) roomSettingsPayload {
	if len(args) == 0 {
		return roomSettingsPayload{}
	}

	raw, ok := args[0].(map[string]any)
	if !ok {
		return roomSettingsPayload{}
	}

	payload := roomSettingsPayload{}
	payload.TurnSeconds = intFromJSON(raw["turnSeconds"])
	payload.TotalCards = intFromJSON(raw["totalCards"])
	return payload
}

func parseRoomStartPayload(args []any) roomStartPayload {
	if len(args) == 0 {
		return roomStartPayload{}
	}

	raw, ok := args[0].(map[string]any)
	if !ok {
		return roomStartPayload{}
	}

	payload := roomStartPayload{}
	payload.TurnSeconds = intFromJSON(raw["turnSeconds"])
	payload.TotalCards = intFromJSON(raw["totalCards"])
	return payload
}

func intFromJSON(v any) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case int64:
		return int(n)
	default:
		return 0
	}
}

func isAllowedTurnSeconds(n int) bool {
	switch n {
	case 0, 15, 20, 30, 45, 60:
		return true
	default:
		return false
	}
}

func isAllowedTotalCards(n int) bool {
	return n == 26 || n == 39 || n == 52
}

func (s *roomStore) createRoom(socketID, name string, characterIndex int) *RoomState {
	s.mu.Lock()
	defer s.mu.Unlock()

	if oldRoomID, ok := s.socketToRoom[socketID]; ok {
		s.removeFromRoomLocked(nil, socketID, oldRoomID)
	}

	roomID := s.generateUniqueRoomIDLocked()
	state := &RoomState{
		ID:           roomID,
		HostSocketID: socketID,
		Capacity:     fixedRoomCapacity,
		Status:       roomStatusWaiting,
		TurnSeconds:  0,
		TotalCards:   26,
		Users: []RoomUser{
			{
				SocketID:       socketID,
				Name:           name,
				CharacterIndex: characterIndex,
			},
		},
	}
	s.rooms[roomID] = state
	s.socketToRoom[socketID] = roomID
	return cloneRoomState(state)
}

func (s *roomStore) updateRoomSettings(socketID string, p roomSettingsPayload) (*RoomState, string, string) {
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
		return nil, "NOT_HOST", "Only the host can change room settings."
	}

	if state.Status != roomStatusWaiting {
		return nil, "INVALID_ROOM_STATUS", "Settings can only be changed while the room is waiting."
	}

	if !isAllowedTurnSeconds(p.TurnSeconds) {
		return nil, "INVALID_SETTINGS", "Invalid turn time."
	}

	totalCards := p.TotalCards
	if !isAllowedTotalCards(totalCards) {
		return nil, "INVALID_SETTINGS", "Invalid total cards."
	}

	state.TurnSeconds = p.TurnSeconds
	state.Capacity = fixedRoomCapacity
	state.TotalCards = totalCards
	return cloneRoomState(state), "", ""
}

func (s *roomStore) startRoom(socketID string, p roomStartPayload) (*RoomState, string, string) {
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

	state.TurnSeconds = p.TurnSeconds
	state.TotalCards = p.TotalCards
	state.Status = roomStatusStarted
	return cloneRoomState(state), "", ""
}

func (s *roomStore) joinRoom(socketID, roomID, name string, characterIndex int) (*RoomState, string, string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	state, exists := s.rooms[roomID]
	if !exists {
		return nil, "ROOM_NOT_FOUND", "Room does not exist."
	}

	if oldRoomID, ok := s.socketToRoom[socketID]; ok && oldRoomID != roomID {
		s.removeFromRoomLocked(nil, socketID, oldRoomID)
	}

	for _, user := range state.Users {
		if user.SocketID == socketID {
			return cloneRoomState(state), "", ""
		}
	}

	if len(state.Users) >= state.Capacity {
		return nil, "ROOM_FULL", "Room is full."
	}
	if state.Status != roomStatusWaiting {
		return nil, "ROOM_NOT_JOINABLE", "Cannot join a room that has already started or finished."
	}

	state.Users = append(state.Users, RoomUser{
		SocketID:       socketID,
		Name:           name,
		CharacterIndex: characterIndex,
	})
	s.socketToRoom[socketID] = roomID
	return cloneRoomState(state), "", ""
}

func (s *roomStore) leaveRoom(io *server.Server, socketID string) (*RoomState, string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	roomID, ok := s.socketToRoom[socketID]
	if !ok {
		return nil, ""
	}

	state := s.removeFromRoomLocked(io, socketID, roomID)
	return state, roomID
}

func (s *roomStore) getSocketRoomAndName(socketID string) (string, string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	roomID, ok := s.socketToRoom[socketID]
	if !ok {
		return "", "", false
	}

	state, ok := s.rooms[roomID]
	if !ok {
		return "", "", false
	}

	for _, user := range state.Users {
		if user.SocketID == socketID {
			return roomID, user.Name, true
		}
	}

	return "", "", false
}

func (s *roomStore) removeFromRoomLocked(io *server.Server, socketID, roomID string) *RoomState {
	state, exists := s.rooms[roomID]
	if !exists {
		delete(s.socketToRoom, socketID)
		return nil
	}

	if game, ok := s.games[roomID]; ok {
		wasCurrentTurn := game.currentPlayerID() == socketID
		wasLastBettor := game.LastBetPlayerID == socketID
		delete(game.Hands, socketID)
		for idx := 0; idx < len(game.TurnOrder); idx++ {
			if game.TurnOrder[idx] == socketID {
				game.TurnOrder = append(game.TurnOrder[:idx], game.TurnOrder[idx+1:]...)
				if len(game.TurnOrder) == 0 {
					game.TurnIndex = 0
				} else if game.TurnIndex >= len(game.TurnOrder) {
					game.TurnIndex = 0
				}
				break
			}
		}
		if io != nil {
			outcome := s.handlePlayerDepartureLocked(io, state, game, socketID, wasCurrentTurn, wasLastBettor)
			s.emitDepartureOutcomeLocked(io, state, game, outcome, socketID, "player_left")
		}
	}

	nextUsers := make([]RoomUser, 0, len(state.Users))
	for _, user := range state.Users {
		if user.SocketID == socketID {
			continue
		}
		nextUsers = append(nextUsers, user)
	}

	state.Users = nextUsers
	delete(s.socketToRoom, socketID)

	if len(state.Users) == 0 {
		s.stopTimerLocked(roomID)
		delete(s.games, roomID)
		delete(s.rooms, roomID)
		return nil
	}

	if state.HostSocketID == socketID {
		state.HostSocketID = state.Users[0].SocketID
	}

	return cloneRoomState(state)
}

func (s *roomStore) generateUniqueRoomIDLocked() string {
	for {
		code := make([]rune, roomCodeLength)
		for i := 0; i < roomCodeLength; i++ {
			code[i] = roomCodeCharset[roomRng.Intn(len(roomCodeCharset))]
		}

		roomID := string(code)
		if _, exists := s.rooms[roomID]; !exists {
			return roomID
		}
	}
}

func cloneRoomState(state *RoomState) *RoomState {
	clone := *state
	clone.Users = append([]RoomUser(nil), state.Users...)
	return &clone
}
