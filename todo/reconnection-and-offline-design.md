# Reconnection, offline state, and transport health

This document captures the design decisions and behavior for **mid-game disconnects**, **grace / offline**, and how that relates to **Engine.IO ping/pong** vs **application** logic. Use it as the reference for implementation and tests.

## Goals

- When a user’s **WebSocket / Socket.IO connection** drops, other players are informed (e.g. “offline” or updated `room:state`).
- Optionally keep their **seat and game state** for a **grace period** (Option A), then **remove** if they do not reattach in time.
- On **reconnect**, a **new `socketId`** should map back to the **same logical player** (Option B) using stable identity — not `socketId`.

## Core identity (do not key game state on `socketId`)

| Field | Role |
|--------|------|
| `socketId` | **Transport** id; **changes** every new connection. |
| `deviceId` | **Stable** client id (e.g. generated once, `localStorage`). Used to **claim** a seat after reconnect. |
| `playerId` (recommended) | **Server-issued** id for “this seat in this room”; best stable key for **hands, turns, and persistence** inside the room. |

**Game state** (cards, turn order) should be keyed by **`playerId` + `roomId`**, and optionally look up or verify with **`deviceId`** on resume.

## Engine.IO: ping, pong, and when the server “knows” the link is dead

- The **server** uses **`pingInterval`** and **`pingTimeout`**: it expects a healthy round-trip; if not, the **transport** is considered dead and the **connection closes** → your code receives **`disconnect`**.
- A **sudden** network loss is often **not** instant: detection waits until the **next failed** ping/pong window (roughly in the **seconds** range, depending on your engine config).
- **You do not** need to reimplement this low-level liveness in the app layer for “is the TCP/engine connection alive?”.
- **Transport ping** only runs on **open** connections. A client that is **fully disconnected** has **no** socket to ping until they open a **new** connection.

## Server-side `disconnect` handler (your responsibility)

1. **Resolve** which room and which **logical player** (by old `socketId` → your maps).
2. **Do not** use `socketId` as the long-term game key; update or clear `currentSocketId` for that `playerId`.
3. **Option A — grace:** set player status to **`offline`**, set `disconnectedAt`, **keep seat + hand** (game rules permitting).
4. **Emit to the room** (e.g. `room:state` with `status: "offline"` for that player) so UIs can grey out the avatar, show “reconnecting…”, etc.
5. **Start a removal / forfeit timer** (your **disconnect interval** / grace T). If the player has **not** completed **`room:resume` (or equivalent)** before the timer, **remove** or **forfeit** and broadcast again.
6. If the **same** player **reconnects in time** with valid **`roomId` + `deviceId` (and `playerId` if you use it)** → **cancel** the timer, bind **new** `socketId`, set **`connected`**, **resync** state (including private hand) to that socket only.

**Socket.IO / Engine** does **not** automatically tell other clients “this user is offline” at the **game** level; you **emit** that.

## Custom “game ping” (optional, separate from Engine)

- If you add **`game:ping` / `game:pong`**, only target players with `status === "connected"`; **skip** `offline` / grace-only players who have no active transport (or define policy explicitly).
- This is for **stricter in-game** presence or **anti-AFK** rules, **not** a replacement for Engine liveness for the wire itself.

## Two related “disconnect” concepts (avoid mix-ups)

- **Engine disconnect:** no active socket; no transport ping to that id until **reconnect**.
- **Application `offline` with reserved seat:** your **in-memory (or DB)** state says “this seat is still theirs” for a **grace** window; the **low-level** link may already be **gone** — you are **not** pinging a ghost socket; you wait for a **new** `connection` and then **`room:resume`**.

## Client behavior (minimal)

- Generate / persist **`deviceId`**.
- On **socket `connect`**, if the app knows **`roomId`** and identity, send **`room:resume`** (or your chosen event) so the server can rebind and resync.
- On **`disconnect`**, show **reconnecting** UI; rely on the client’s auto-reconnect when possible, then **resume** game session on the server.

## Policy checklist (set explicitly in code / rules)

- **Grace duration** `T_offline` before **kick / forfeit / free seat**
- **Turn** behavior while offline: pause clock, auto-pass, skip, or forfeit
- **Two tabs** / duplicate `deviceId` connections: reject, or last-wins, or one policy
- **Room empty:** destroy room; **rejoin** only while room exists
- **Server restart:** in-memory only → full loss; **persistence** (e.g. Mongo) needed for survival across process restarts

## Implementation TODO (from project notes and design)

- [ ] Add **`deviceId`** to user/player payload (create, join, resume).
- [ ] Add server-issued **`playerId`** per seat in room (recommended).
- [ ] On **`disconnect`:** mark `offline` (or remove — choose policy), emit room update, start **removal / forfeit** timer; cancel on **resume**.
- [ ] Add **`room:resume`** (or extend join) to bind **new `socketId`**, validate **`roomId` + `deviceId` (+ `playerId`)**, resync state to client.
- [ ] **Do not** remove player from `room:state` immediately if using grace — or document if you do immediate removal.
- [ ] (Optional) App-level `game:ping` only to **`connected`** players, if you need stricter than Engine.
- [ ] (Optional) Align with notes in `backend/dev.notes.txt`: verify whether **3s app ping** is still desired given Engine ping, or if that becomes **game-layer** only.

## Related files (current stack)

- Room / socket: `backend/socket.go`
- Optional persistence: `backend/db.go`, Mongo config via env

---

*Last updated: design + TODO summary for reconnection and offline behavior.*
