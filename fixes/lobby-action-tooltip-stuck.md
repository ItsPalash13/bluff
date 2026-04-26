# Fix: Avatar tooltip stuck on "Pass"

## Context

The room UI shows short-lived tooltip bubbles above player avatars for:
- Chat messages (`room:message`)
- Game action toasts (`player_move`, `player_pass`, `bluff_called`)

Action events are emitted in `Room` and passed to `Lobby` as `gameActionToast`.

```240:312:frontend/src/Layouts/Room/Room.tsx
// ... listener setup ...
const onPlayerMove = (raw: unknown) => { /* sets "Bluff <count> <rank>" */ }
const onPlayerPass = (raw: unknown) => { /* sets "Pass" */ }
const onBluffCalled = (raw: unknown) => { /* sets "Call" */ }
socket.on('player_move', onPlayerMove)
socket.on('player_pass', onPlayerPass)
socket.on('bluff_called', onBluffCalled)
```

In `Lobby`, action bubbles take priority over chat bubbles:

```83:86:frontend/src/Layouts/Room/Lobby.jsx
const actionMessage = actionBubbles[user.socketId]
const chatMessage = messageBubbles[user.socketId]
const bubbleMessage = actionMessage || chatMessage
const bubbleIsAction = Boolean(actionMessage)
```

So if an action bubble is not removed correctly, it appears "stuck."

---

## What happened (root cause)

### Previous behavior (buggy)

Before the fix, each `useEffect` update used one timeout tied to the latest toast prop change.

When a new toast arrived, React ran cleanup for the previous effect (`return () => clearTimeout(timeout)`), which canceled the older pending removal timer—even if it was for a different socket/player.

Result: some older action bubbles (often "Pass") remained in state and did not clear on time.

---

## React behavior behind it

For `useEffect`:
1. Effect runs after render.
2. On dependency change, React runs previous cleanup first.
3. Then React runs the new effect.

If you rely on one "latest effect timer" to remove many independently keyed UI items, dependency changes can cancel unrelated removals.

That is exactly what this bug hit: toast stream changed quickly across players, and cleanup canceled the prior global timer.

---

## Fix applied

Use **per-socket timers** stored in refs:

- `chatBubbleTimersRef`
- `actionBubbleTimersRef`

For each incoming toast/message:
1. Compute `socketId`.
2. Cancel only that socket's previous timer (if any).
3. Start a new timer for that same socket.
4. On timeout, delete only that socket's bubble from state.

Also added unmount cleanup to clear all timers.

```27:74:frontend/src/Layouts/Room/Lobby.jsx
const chatBubbleTimersRef = useRef({})
const actionBubbleTimersRef = useRef({})

useEffect(() => {
  // ... set messageBubbles[socketId]
  const prevTimer = chatBubbleTimersRef.current[socketId]
  if (prevTimer) clearTimeout(prevTimer)
  chatBubbleTimersRef.current[socketId] = setTimeout(() => {
    setMessageBubbles((prev) => {
      const next = { ...prev }
      delete next[socketId]
      return next
    })
    delete chatBubbleTimersRef.current[socketId]
  }, bubbleTimeoutMs)
}, [lastMessage])

useEffect(() => {
  // ... set actionBubbles[socketId]
  const prevTimer = actionBubbleTimersRef.current[socketId]
  if (prevTimer) clearTimeout(prevTimer)
  actionBubbleTimersRef.current[socketId] = setTimeout(() => {
    setActionBubbles((prev) => {
      const next = { ...prev }
      delete next[socketId]
      return next
    })
    delete actionBubbleTimersRef.current[socketId]
  }, actionBubbleTimeoutMs)
}, [gameActionToast])

useEffect(() => {
  return () => {
    Object.values(chatBubbleTimersRef.current).forEach((timerId) => clearTimeout(timerId))
    Object.values(actionBubbleTimersRef.current).forEach((timerId) => clearTimeout(timerId))
  }
}, [])
```

---

## Why this works

Bubble lifecycle becomes independent per player.

- New events for Player B no longer cancel Player A's pending removal.
- Repeated events for the same player correctly refresh only that player's timer.
- Action priority over chat still works, but no stale action bubble remains forever.

---

## Quick verification checklist

1. Trigger `Pass` for Player A, then immediately trigger `Bluff` for Player B.
2. Verify A's `Pass` bubble disappears after ~1s.
3. Verify B's bubble also disappears after ~1s.
4. Send chat while action bubble is active for the same player:
   - Action bubble shows first.
   - Chat bubble appears after action expires.
