# Waiting Lobby: Background / Foreground Recovery

This note explains a production-only issue affecting the **waiting** stage (before the host starts the game), how we diagnosed it against local development behavior, and what we changed.

## Symptom

On a **deployed** build accessed from a **mobile browser**, switching away from the app (home gesture, another app, lock screen, etc.) could leave the user stuck showing “Waiting for the host…” **without** triggering the **`GET /api/rooms/eligibility`** request visible in DevTools—the same flows that appeared after opening the `/roomCode` route. **Pull-to-refresh** or reloading the page made things work again.

**Socket.IO traffic** (`/socket.io/…polling`) could still appear, which reinforced that raw transport connectivity is not the same as **successful application-level reclaim** (`room:join` with `playerId`).

## Why `npm run dev` Often Looked Fine

Local development exaggerated or masked the gap for several unrelated reasons:

- **Full page reload** is common during development (saving files, restarting Vite, manual refresh). Reloading **`/roomCode`** runs **`CreateNJoin`** from a clean mount—that path performs eligibility checks and emits **`room:join`** (see [`reconnection-logic.md`](./reconnection-logic.md)).
- Dev usage is often **desktop-first**; tabs are not frozen the same way as **mobile Safari/Chrome**.
- Optional: **Strict Mode** in development changes mount/teardown timing. That does **not** replace reclaim logic inside **`Room`**, but timing differences can confuse debugging.

Together, frequent reloads re-entered the **CreateNJoin-only** reclaim path unintentionally**, so reclaim missing from **`Room`** went unnoticed.**

## Why Production on the Phone Misbehaved

1. **`CreateNJoin` is not mounted once you’re in a room.**  
   In **`App.tsx`**, after join, `roomSession` is set and the UI renders **`Room`** only—not the route **`CreateNJoin`** element. Returning from background **does not unmount/remount that tree** automatically, so **`CreateNJoin`’s eligibility + auto `room:join` effects never run.**

2. **Reconnect requires reclaim at the Socket.IO edge.**  
   When the underlying connection drops or the socket id rotates, the server maps the reconnecting transport to room membership through **`joinRoom`** (reclaim by **`playerId`**). Clients must **`emit('room:join', …)`** with **`playerId`**. Polling/`connect` alone does **not** replay that.

3. **`useMatch('/:roomId')` inside `Room` was brittle** while **`Room` renders outside `<Routes>`**—filtering **`room:state`** by URL params could fail silently; we now normalize against **`roomSession.room.id`** via a ref.

## Fix (overview)

Waiting-lobby recovery was implemented **inside **`Room`**** so behavior does not depend only on **`CreateNJoin`** mount:

| Piece | Purpose |
|--------|--------|
| **`runWaitingLobbyReconnect`** (`Room.tsx`) | If status is **`waiting`**, reads `bluff:session:<ROOM_CODE>`, validates against **`roomSession.playerId`**, **`GET /api/rooms/eligibility`**, then **`room:join`**—aligned with **`CreateNJoin`** |
| **`scheduleWaitingLobbyReconnect`** | Debounce (~260 ms) to coalesce rapid events |
| Triggers | Socket **`connect`**, **`visibilitychange` → visible**, **`window.online`**, **`pageshow`** when **`event.persisted`**, and entering **`waiting`** (e.g. after “Play again”) |

If eligibility returns **`eligible: false`**, we clear stale storage and **`location.reload()`** so the route can bootstrap through join UI again—same spirit as rejecting stale identity elsewhere.

Shared storage key **`roomSessionStorageKey`** lives in **`frontend/src/session/roomSessionStorage.ts`** so **`CreateNJoin`**, **`App`**, and **`Room`** stay consistent.

Primary implementation: **`frontend/src/Layouts/Room/Room.tsx`** (search for “Waiting lobby” / `runWaitingLobbyReconnect`).

## Related

- [Reconnection Logic](./reconnection-logic.md)—player id, versioning, eligibility API, and backend rules.
