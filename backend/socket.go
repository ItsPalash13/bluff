package main

import (
	crand "crypto/rand"
	"encoding/hex"
	"fmt"
	"math/rand"
	"net/http"
	"os"
	"strconv"
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
	PlayerID       string `json:"playerId"`
	SocketID       string `json:"socketId"`
	Name           string `json:"name"`
	CharacterIndex int    `json:"characterIndex"`
	Connected      bool   `json:"connected"`
	DisconnectedAt int64  `json:"disconnectedAt"`
}

type RoomState struct {
	ID           string     `json:"id"`
	// Version is a room-instance identifier used by reconnect eligibility checks.
	Version      int64      `json:"version"`
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
	PlayerID       string `json:"playerId"`
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
	socketToUser map[string]string
	// expiredUsers tracks reconnect identities that missed grace expiry per room.
	expiredUsers map[string]map[string]bool
	games        map[string]*GameState
	turnTimers   map[string]chan struct{}
	// disconnectTimers keeps waiting-lobby reconnect grace timers by room:player.
	disconnectTimers map[string]*time.Timer
}

func newRoomStore() *roomStore {
	return &roomStore{
		rooms:        map[string]*RoomState{},
		socketToRoom: map[string]string{},
		socketToUser: map[string]string{},
		expiredUsers: map[string]map[string]bool{},
		games:        map[string]*GameState{},
		turnTimers:   map[string]chan struct{}{},
		disconnectTimers: map[string]*time.Timer{},
	}
}

// allowedCorsOrigins reads comma-separated browser origins from ALLOWED_ORIGINS.
// Example: "http://localhost:5173,https://app.example.com"
// If empty, local Vite dev defaults are used.
func allowedCorsOrigins() []any {
	raw := strings.TrimSpace(os.Getenv("ALLOWED_ORIGINS"))
	if raw == "" {
		return []any{
			"http://localhost:5173",
			"http://127.0.0.1:5173",
		}
	}
	parts := strings.Split(raw, ",")
	out := make([]any, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	if len(out) == 0 {
		return []any{"http://localhost:5173"}
	}
	return out
}

func newSocketServer() (*server.Server, *roomStore) {
	origins := allowedCorsOrigins()
	fmt.Printf("cors: allowed origins = %v\n", origins)
	opts := server.DefaultServerOptions()
	opts.SetCors(&types.Cors{
		Origin:      origins,
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

			state, user := store.createRoom(socketID, payload.Name, payload.CharacterIndex)
			fmt.Printf("[socket] room:create success socket=%s room=%s users=%d\n", socketID, state.ID, len(state.Users))
			socket.Join(server.Room(state.ID))
			socket.Emit("room:created", map[string]any{
				"room":     state,
				"playerId": user.PlayerID,
			})
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

			state, user, errCode, errMsg := store.joinRoom(socketID, payload.RoomID, payload.Name, payload.CharacterIndex, payload.PlayerID)
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
			socket.Emit("room:joined", map[string]any{
				"room":     state,
				"playerId": user.PlayerID,
			})
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

		socket.On("room:updateProfile", func(args ...any) {
			payload := parseRoomPayload(args)
			fmt.Printf("[socket] room:updateProfile from=%s name=%q characterIndex=%d\n", socketID, payload.Name, payload.CharacterIndex)
			if !isValidName(payload.Name) {
				fmt.Printf("[socket] room:updateProfile rejected socket=%s reason=INVALID_NAME\n", socketID)
				socket.Emit("room:error", map[string]any{
					"code":    "INVALID_NAME",
					"message": "Name is required to update profile.",
				})
				return
			}
			state, errCode, errMsg := store.updateUserProfile(socketID, payload.Name, payload.CharacterIndex)
			if errCode != "" {
				fmt.Printf("[socket] room:updateProfile rejected socket=%s code=%s message=%q\n", socketID, errCode, errMsg)
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

		socket.On("room:restart", func(args ...any) {
			fmt.Printf("[socket] room:restart from=%s\n", socketID)
			if errCode, errMsg := store.restartRoom(io, socketID); errCode != "" {
				fmt.Printf("[socket] room:restart rejected socket=%s code=%s message=%q\n", socketID, errCode, errMsg)
				socket.Emit("room:error", map[string]any{
					"code":    errCode,
					"message": errMsg,
				})
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
			state, _ := store.disconnectSocket(io, socketID)
			if state != nil {
				emitRoomState(io, state)
			}
		})
	})

	return io, store
}

// handleRoomEligibility reports whether a reconnect attempt is valid for a room instance.
// Frontend calls this before auto-rejoin using roomId + playerId + version.
func handleRoomEligibility(store *roomStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet {
			http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
			return
		}
		roomID := strings.TrimSpace(strings.ToUpper(r.URL.Query().Get("roomId")))
		playerID := strings.TrimSpace(r.URL.Query().Get("playerId"))
		versionRaw := strings.TrimSpace(r.URL.Query().Get("version"))
		// Reconnect version must be parseable and positive; invalid means ineligible.
		version, err := strconv.ParseInt(versionRaw, 10, 64)
		if err != nil || version <= 0 {
			version = 0
		}
		w.Header().Set("Content-Type", "application/json")
		eligible := store.playerInRoom(roomID, playerID, version)
		_, _ = w.Write([]byte(fmt.Sprintf(`{"eligible":%t}`, eligible)))
	}
}

func (s *roomStore) playerInRoom(roomID, playerID string, version int64) bool {
	if roomID == "" || playerID == "" || version <= 0 {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	state, ok := s.rooms[roomID]
	if !ok {
		return false
	}
	// Reconnect guard: prevent stale local session from older room instances.
	if state.Version != version {
		return false
	}
	for _, u := range state.Users {
		if u.PlayerID == playerID {
			return true
		}
	}
	return false
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
	if playerID, ok := raw["playerId"].(string); ok {
		payload.PlayerID = strings.TrimSpace(playerID)
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

const reconnectGrace = 30 * time.Second

func randomID(prefix string) string {
	b := make([]byte, 16)
	if _, err := crand.Read(b); err != nil {
		return fmt.Sprintf("%s-%d", prefix, time.Now().UnixNano())
	}
	return fmt.Sprintf("%s-%s", prefix, hex.EncodeToString(b))
}

func (s *roomStore) createRoom(socketID, name string, characterIndex int) (*RoomState, RoomUser) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if oldRoomID, ok := s.socketToRoom[socketID]; ok {
		s.removeFromRoomLocked(nil, socketID, oldRoomID)
	}

	roomID := s.generateUniqueRoomIDLocked()
	playerID := randomID("p")
	state := &RoomState{
		ID:           roomID,
		// Reconnect version for this concrete room instance.
		Version:      time.Now().UnixMilli(),
		HostSocketID: socketID,
		Capacity:     fixedRoomCapacity,
		Status:       roomStatusWaiting,
		TurnSeconds:  0,
		TotalCards:   26,
		Users: []RoomUser{
			{
				PlayerID:       playerID,
				SocketID:       socketID,
				Name:           name,
				CharacterIndex: characterIndex,
				Connected:      true,
				DisconnectedAt: 0,
			},
		},
	}
	s.rooms[roomID] = state
	s.socketToRoom[socketID] = roomID
	s.socketToUser[socketID] = playerID
	return cloneRoomState(state), state.Users[0]
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

func (s *roomStore) updateUserProfile(socketID, name string, characterIndex int) (*RoomState, string, string) {
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

	if state.Status != roomStatusWaiting {
		return nil, "INVALID_ROOM_STATUS", "Profile can only be changed while the room is waiting."
	}

	for i := range state.Users {
		if state.Users[i].PlayerID != s.socketToUser[socketID] {
			continue
		}
		state.Users[i].Name = name
		state.Users[i].CharacterIndex = characterIndex
		return cloneRoomState(state), "", ""
	}

	return nil, "ROOM_NOT_FOUND", "You are not in this room."
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

func (s *roomStore) joinRoom(socketID, roomID, name string, characterIndex int, playerID string) (*RoomState, RoomUser, string, string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	state, exists := s.rooms[roomID]
	if !exists {
		return nil, RoomUser{}, "ROOM_NOT_FOUND", "Room does not exist."
	}
	// Reconnect is intentionally lobby-only.
	if state.Status != roomStatusWaiting {
		return nil, RoomUser{}, "ROOM_NOT_JOINABLE", "Cannot join or rejoin a room that has already started or finished."
	}

	if oldRoomID, ok := s.socketToRoom[socketID]; ok && oldRoomID != roomID {
		s.removeFromRoomLocked(nil, socketID, oldRoomID)
	}

	// Reconnect reclaim path: match existing slot by playerId and swap socket.
	reclaimed := -1
	if playerID != "" {
		for i := range state.Users {
			if playerID != "" && state.Users[i].PlayerID == playerID {
				reclaimed = i
				break
			}
		}
	}
	if reclaimed != -1 {
		user := &state.Users[reclaimed]
		if expired, ok := s.expiredUsers[roomID]; ok {
			delete(expired, user.PlayerID)
		}
		// Cancel pending reconnect grace timer because user reclaimed successfully.
		timerKey := roomID + ":" + user.PlayerID
		if t, ok := s.disconnectTimers[timerKey]; ok {
			t.Stop()
			delete(s.disconnectTimers, timerKey)
		}
		oldSocketID := user.SocketID
		user.SocketID = socketID
		user.Connected = true
		user.DisconnectedAt = 0
		if state.HostSocketID == oldSocketID {
			state.HostSocketID = socketID
		}
		s.socketToRoom[socketID] = roomID
		s.socketToUser[socketID] = user.PlayerID
		if oldSocketID != "" && oldSocketID != socketID {
			delete(s.socketToRoom, oldSocketID)
			delete(s.socketToUser, oldSocketID)
		}
		return cloneRoomState(state), *user, "", ""
	}

	for _, user := range state.Users {
		if user.SocketID == socketID || (playerID != "" && user.PlayerID == playerID) {
			return cloneRoomState(state), user, "", ""
		}
	}

	if expired, ok := s.expiredUsers[roomID]; ok {
		if playerID != "" && expired[playerID] {
			if state.Status != roomStatusWaiting {
				return nil, RoomUser{}, "RECONNECT_WINDOW_EXPIRED", "Oops, socket disconnected. Game is underway."
			}
		}
	}

	if len(state.Users) >= state.Capacity {
		return nil, RoomUser{}, "ROOM_FULL", "Room is full."
	}
	newUser := RoomUser{
		PlayerID:       randomID("p"),
		SocketID:       socketID,
		Name:           name,
		CharacterIndex: characterIndex,
		Connected:      true,
		DisconnectedAt: 0,
	}
	state.Users = append(state.Users, newUser)
	s.socketToRoom[socketID] = roomID
	s.socketToUser[socketID] = newUser.PlayerID
	if expired, ok := s.expiredUsers[roomID]; ok {
		delete(expired, newUser.PlayerID)
	}
	return cloneRoomState(state), newUser, "", ""
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

func (s *roomStore) disconnectSocket(io *server.Server, socketID string) (*RoomState, string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	roomID, ok := s.socketToRoom[socketID]
	if !ok {
		return nil, ""
	}
	state, exists := s.rooms[roomID]
	if !exists {
		delete(s.socketToRoom, socketID)
		delete(s.socketToUser, socketID)
		return nil, roomID
	}
	playerID := s.socketToUser[socketID]
	if state.Status != roomStatusWaiting {
		// Outside waiting lobby, disconnect is treated as hard leave immediately.
		next := s.removeFromRoomByPlayerLocked(io, playerID, roomID)
		return next, roomID
	}
	for i := range state.Users {
		if state.Users[i].PlayerID != playerID {
			continue
		}
		state.Users[i].Connected = false
		state.Users[i].DisconnectedAt = time.Now().UnixMilli()
		// Waiting-lobby reconnect grace timer starts on disconnect.
		timerKey := roomID + ":" + playerID
		if t, ok := s.disconnectTimers[timerKey]; ok {
			t.Stop()
		}
		s.disconnectTimers[timerKey] = time.AfterFunc(reconnectGrace, func() {
			s.hardRemoveDisconnectedUser(io, roomID, playerID)
		})
		break
	}
	delete(s.socketToRoom, socketID)
	delete(s.socketToUser, socketID)
	return cloneRoomState(state), roomID
}

func (s *roomStore) hardRemoveDisconnectedUser(io *server.Server, roomID, playerID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	timerKey := roomID + ":" + playerID
	delete(s.disconnectTimers, timerKey)
	state, exists := s.rooms[roomID]
	if !exists {
		return
	}
	// If user already reclaimed, do nothing.
	for _, user := range state.Users {
		if user.PlayerID == playerID && user.Connected {
			return
		}
	}
	for _, user := range state.Users {
		if user.PlayerID == playerID {
			state = s.removeFromRoomByPlayerLocked(io, playerID, roomID)
			break
		}
	}
	// Mark reconnect identity as expired to block stale auto-rejoin attempts.
	if _, ok := s.expiredUsers[roomID]; !ok {
		s.expiredUsers[roomID] = map[string]bool{}
	}
	s.expiredUsers[roomID][playerID] = true
	if state != nil {
		emitRoomState(io, state)
	}
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

	playerID := s.socketToUser[socketID]
	for _, user := range state.Users {
		if user.PlayerID == playerID {
			return roomID, user.Name, true
		}
	}

	return "", "", false
}

func (s *roomStore) removeFromRoomLocked(io *server.Server, socketID, roomID string) *RoomState {
	playerID := s.socketToUser[socketID]
	if playerID != "" {
		return s.removeFromRoomByPlayerLocked(io, playerID, roomID)
	}
	state, exists := s.rooms[roomID]
	if !exists {
		delete(s.socketToRoom, socketID)
		delete(s.socketToUser, socketID)
		return nil
	}
	return cloneRoomState(state)
}

func (s *roomStore) removeFromRoomByPlayerLocked(io *server.Server, playerID, roomID string) *RoomState {
	state, exists := s.rooms[roomID]
	if !exists {
		return nil
	}

	socketID := ""
	for _, u := range state.Users {
		if u.PlayerID == playerID {
			socketID = u.SocketID
			break
		}
	}
	timerKey := roomID + ":" + playerID
	if t, ok := s.disconnectTimers[timerKey]; ok {
		t.Stop()
		delete(s.disconnectTimers, timerKey)
	}

	if game, ok := s.games[roomID]; ok {
		wasCurrentTurn := game.currentPlayerID() == playerID
		wasLastBettor := game.LastBetPlayerID == playerID
		delete(game.Hands, playerID)
		for idx := 0; idx < len(game.TurnOrder); idx++ {
			if game.TurnOrder[idx] == playerID {
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
			outcome := s.handlePlayerDepartureLocked(io, state, game, playerID, wasCurrentTurn, wasLastBettor)
			s.emitDepartureOutcomeLocked(io, state, game, outcome, playerID, "player_left")
		}
	}

	nextUsers := make([]RoomUser, 0, len(state.Users))
	for _, user := range state.Users {
		if user.PlayerID == playerID {
			continue
		}
		nextUsers = append(nextUsers, user)
	}

	state.Users = nextUsers
	delete(s.socketToRoom, socketID)
	delete(s.socketToUser, socketID)

	if len(state.Users) == 0 {
		s.stopTimerLocked(roomID)
		delete(s.games, roomID)
		delete(s.rooms, roomID)
		delete(s.expiredUsers, roomID)
		return nil
	}

	if state.HostSocketID == socketID || state.HostSocketID == "" {
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
