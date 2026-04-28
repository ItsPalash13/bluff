# Reconnection Notes: Mobile app-switch during Invite flow

## Context

When the host creates a room on mobile, taps `Invite`, switches to another app, and comes back, the socket may disconnect with:

- `transport error`
- `transport close`

This is normal on mobile browsers when the tab is backgrounded.

---

## Observed issue

Without reconnection handling:

1. Client disconnects while app is in background.
2. Backend removes player immediately.
3. On return, user appears logged out and must manually join again.

---

## Root cause

- Mobile backgrounding can suspend/kill the active transport.
- Server behavior was "disconnect = immediate leave".
- Client had no automatic room rejoin flow after reconnect.

---

## Implemented approach (can be reapplied later)

## 1) Backend grace window for temporary disconnects

File: `backend/socket.go`

- Add a disconnect grace period (example used: `30 * time.Second`).
- On socket disconnect:
  - mark user as disconnected (`Connected: false`) instead of immediate removal.
  - schedule room cleanup only if all users are disconnected.
- On rejoin (same room + same player name), reclaim old slot:
  - replace old socket id with new socket id
  - restore host ownership if old host socket changed
  - cancel pending cleanup timer

Outcome: short app-switch no longer kills the room immediately.

---

## 2) Frontend auto-rejoin on join route

File: `frontend/src/Layouts/CreateNJoin/CreateNJoin.tsx`

- Persist last entered player name in `localStorage` (example key: `bluff:last-player-name`).
- On `/:roomId` route, when socket is available:
  - auto-attempt one `room:join` with remembered name
  - avoid repeated auto-joins with a per-room "attempted" ref

Outcome: user usually returns directly without pressing Join again.

---

## 3) Visible reconnect state in room

File: `frontend/src/App.tsx`, styles in `frontend/src/App.css`

- While `roomSession` exists and socket is disconnected:
  - show top message: `Please wait, reconnecting you...`
- Auto-hide on reconnect.

Outcome: users understand that reconnection is in progress.

---

## 4) Invite UX + mobile copy fallback

Files:
- `frontend/src/Layouts/Room/RoomSettings.tsx`
- `frontend/src/Layouts/Room/Room.tsx`

Changes:

- Rename button label from `Share` to `Invite`.
- On click:
  - try `navigator.clipboard.writeText(...)`
  - fallback to hidden textarea + `document.execCommand('copy')`
- show toast:
  - success: `Link copied`
  - failure: `Could not copy link on this browser`

Reason: clipboard API can fail on mobile/non-HTTPS contexts.

---

## Environment config

File: `frontend/.env`

```env
VITE_SOCKET_URL=http://<your-local-or-server-host>:8080
```

And in `SocketProvider`, prefer env URL first, then fallback to current host + `:8080`.

---

## Minimal reapply checklist

1. Re-add backend grace disconnect logic in `backend/socket.go`.
2. Re-add frontend auto-rejoin in `CreateNJoin`.
3. Re-add reconnect banner in `App`.
4. Re-add Invite + copy fallback toast in `RoomSettings` and `Room`.
5. Set `VITE_SOCKET_URL` in `frontend/.env`.
6. Restart frontend dev server after `.env` changes.

---

## Notes

- This is not full Socket.IO v4 "connection state recovery"; this is app-level recovery suited to current Go socket stack.
- Keep explicit `room:leave` behavior immediate (user intentionally leaves).
