package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"go.mongodb.org/mongo-driver/v2/mongo/readpref"
)

// Client is the shared MongoDB client, initialized by InitMongo.
var Client *mongo.Client

// DB is the application database, initialized by InitMongo.
var DB *mongo.Database

// InitMongo connects using MONGODB_URI, optionally MONGODB_DB (defaults to "bluff").
// On success, Client and DB are set. The returned function disconnects the client; defer it in main.
func InitMongo(ctx context.Context) (func(), error) {
	uri := os.Getenv("MONGODB_URI")
	if uri == "" {
		return nil, fmt.Errorf("MONGODB_URI environment variable is not set")
	}

	client, err := mongo.Connect(options.Client().ApplyURI(uri))
	if err != nil {
		return nil, fmt.Errorf("mongo connect: %w", err)
	}
	fmt.Println("MongoDB connected successfully")
	pingCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	err = client.Ping(pingCtx, readpref.Primary())
	cancel()
	if err != nil {
		_ = client.Disconnect(ctx)
		return nil, fmt.Errorf("mongo ping: %w", err)
	}

	dbName := os.Getenv("MONGODB_DB")
	if dbName == "" {
		dbName = "bluff"
	}

	Client = client
	DB = client.Database(dbName)

	return func() {
		_ = Client.Disconnect(context.Background())
	}, nil
}
