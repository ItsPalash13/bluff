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
	roomCodeLength = 6
	roomCapacity   = 4
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

type roomStore struct {
	mu           sync.Mutex
	rooms        map[string]*RoomState
	socketToRoom map[string]string
}

func newRoomStore() *roomStore {
	return &roomStore{
		rooms:        map[string]*RoomState{},
		socketToRoom: map[string]string{},
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
			state, previousRoomID := store.leaveRoom(socketID)
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
			state, _ := store.leaveRoom(socketID)
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

func (s *roomStore) createRoom(socketID, name string, characterIndex int) *RoomState {
	s.mu.Lock()
	defer s.mu.Unlock()

	if oldRoomID, ok := s.socketToRoom[socketID]; ok {
		s.removeFromRoomLocked(socketID, oldRoomID)
	}

	roomID := s.generateUniqueRoomIDLocked()
	state := &RoomState{
		ID:           roomID,
		HostSocketID: socketID,
		Capacity:     roomCapacity,
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

func (s *roomStore) joinRoom(socketID, roomID, name string, characterIndex int) (*RoomState, string, string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	state, exists := s.rooms[roomID]
	if !exists {
		return nil, "ROOM_NOT_FOUND", "Room does not exist."
	}

	if oldRoomID, ok := s.socketToRoom[socketID]; ok && oldRoomID != roomID {
		s.removeFromRoomLocked(socketID, oldRoomID)
	}

	for _, user := range state.Users {
		if user.SocketID == socketID {
			return cloneRoomState(state), "", ""
		}
	}

	if len(state.Users) >= state.Capacity {
		return nil, "ROOM_FULL", "Room is full."
	}

	state.Users = append(state.Users, RoomUser{
		SocketID:       socketID,
		Name:           name,
		CharacterIndex: characterIndex,
	})
	s.socketToRoom[socketID] = roomID
	return cloneRoomState(state), "", ""
}

func (s *roomStore) leaveRoom(socketID string) (*RoomState, string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	roomID, ok := s.socketToRoom[socketID]
	if !ok {
		return nil, ""
	}

	state := s.removeFromRoomLocked(socketID, roomID)
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

func (s *roomStore) removeFromRoomLocked(socketID, roomID string) *RoomState {
	state, exists := s.rooms[roomID]
	if !exists {
		delete(s.socketToRoom, socketID)
		return nil
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
