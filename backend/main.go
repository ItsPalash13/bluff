package main

import (
	"context"
	"fmt"
	"log"
	"net/http"

	"github.com/joho/godotenv"
)

func main() {
	_ = godotenv.Load()

	cleanup, err := InitMongo(context.Background())
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	defer cleanup()

	io, roomStore := newSocketServer()

	http.Handle("/socket.io/", io.ServeHandler(nil))
	http.HandleFunc("/api/rooms/eligibility", handleRoomEligibility(roomStore))
	http.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"message":"socket.io ping/pong server running","socketPath":"/socket.io/"}`))
	})
	http.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})

	fmt.Println("Socket.IO server listening on :8080")
	if err := http.ListenAndServe(":8080", nil); err != nil {
		panic(err)
	}
}
