# Game Logic (End-to-End)

## 1. Lobby Phase (`WAITING`)

Players join a room lobby. One player is host.

- **State:** `status = WAITING`
- **Host can configure:**
  - number of cards (`N`)
  - optional room rules
- **Other players:** wait only (no gameplay actions)

### Start game

- **Event:** `START_GAME` (host only)
- **Transition:** `WAITING -> SETUP`
- **Emit:** `setup_start`

## 2. Setup Phase (`SETUP`)

No player interaction; backend-only phase.

### Setup steps

1. Select `N` cards based on host config.
2. Shuffle deck.
3. Shuffle player order.
4. Distribute cards evenly.

### Transition to game

- **Transition:** `SETUP -> IN_ROUND`
- Initialize:
  - `turnIndex = 0`
  - `pile = []`
  - `currentBet = null`
  - `passCount = 0`
  - `firstBetPlayerId = null`
  - `lastBetPlayerId = null`
- **Emit:** `game_start`

## 3. Core Game Loop (`IN_ROUND`)

Game proceeds in turn order, skipping finished players.

### Turn rules

- Only current player can act.
- Each turn has a timer.
- Backend emits `tick` every second.

## 4. Player Actions

### A) Initial bet (`currentBet == null`)

Current player must:

- choose `rank` (e.g. `Q`)
- choose `count` (`1..4`)
- submit cards (cards may be bluff)

Backend updates:

- `pile += cards`
- `currentBet = { rank, count, playerId }`
- `firstBetPlayerId = playerId`
- `lastBetPlayerId = playerId`
- `passCount = 0`
- move to next player

### B) Continuing bet (`currentBet != null`)

Current player may:

1. **`PLAY_BET`**
   - claimed rank must match `currentBet.rank`
   - `count <= 4`
   - `pile += cards`
   - `lastBetPlayerId = playerId`
   - `passCount = 0`
   - move to next player
2. **`PASS`**
   - `passCount++`
3. **`CALL_BLUFF`**
   - allowed anytime after a bet exists
   - interrupts normal turn flow

## 5. Bluff Resolution

### Case 1: Bluff true (last bettor lied)

- `lastBetPlayer` takes full pile
- `hands[lastBetPlayer] += pile`

Round reset:

- `pile = []`
- `currentBet = null`
- `passCount = 0`
- `turnIndex = callerId`
- `firstBetPlayerId = callerId`
- `lastBetPlayerId = null`

### Case 2: Bluff false (caller wrong)

- caller takes full pile
- `hands[caller] += pile`

Round reset:

- `pile = []`
- `currentBet = null`
- `passCount = 0`
- `turnIndex = lastBetPlayerId`
- `firstBetPlayerId = lastBetPlayerId`
- `lastBetPlayerId = null`

## 6. Pass Loop Rule (Final)

Flush happens **only** when all are true:

- a bet exists
- all other players pass
- turn returns to `lastBetPlayer`
- `lastBetPlayer` also passes

On flush:

- `pile = []`
- `currentBet = null`
- `passCount = 0`
- `turnIndex = nextPlayerAfter(firstBetPlayerId)`
- `firstBetPlayerId = null`
- `lastBetPlayerId = null`

## 7. Timer Rules

Each turn has fixed duration.

On timeout:

- if `currentBet == null`: skip turn; next player makes initial bet
- if `currentBet != null`: treat timeout as `PASS`
- special case: if `currentPlayer == lastBetPlayer` and timeout, trigger flush

## 8. Turn Movement

- Always move to next active player only.
- `turnIndex = nextActivePlayer(turnIndex)`

## 9. Player Completion and Ranking

### 9.1 Completion baseline

When a player has `0` cards:

- remove from `activePlayers`
- append to `finishedPlayers`

Effects:

- cannot play
- cannot pass
- cannot call bluff
- skipped in turn rotation

Important: completion checks happen after:

- move
- bluff resolution
- penalty assignment

### 9.2 Unresolved last-bet responsibility rule

A player is **not** immediately finished just because their hand reaches `0` during a bet.

If a player's hand becomes `0` and that player is still the `lastBetPlayer` for the current unresolved pile, they remain active for round responsibility until that bet is resolved.

A last bet is considered resolved only when one of the following happens:

1. a subsequent valid bet is played on top of it
2. bluff is called and resolved
3. round ends through valid pass-loop flush

Until one of those resolution events occurs:

- the `lastBetPlayer` cannot be marked finished
- they are still considered active in round context
- they cannot bypass challenge responsibility for that unresolved pile

Pass-loop edge case:

- if pass loop completes and turn returns to `lastBetPlayer`
- and `lastBetPlayer` has `0` cards
- then they auto-pass
- flush resolves the round immediately
- and that player is marked finished and ranked at once

After resolution:

- if that player's hand is still `0`, then mark them finished
- remove from active turn rotation
- append to ranking in finish order

## 10. Game End (`GAME_END`)

When `len(activePlayers) == 1`:

- `lastPlayer = activePlayers[0]`
- append `lastPlayer` to `finishedPlayers`
- set `status = GAME_END`
- emit `game_end`

Final ranking = `finishedPlayers` order:

1. first to finish
2. second
3. third
4. ...
5. last (loser)

## 11. Critical Rules (Do Not Break)

- Server is source of truth.
- Clients never validate moves.
- Process one game event at a time per room.
- Bluff resolution must be atomic.
- Ignore duplicate bluff calls.
- Always reset round state after bluff/flush.

## 12. Player Disconnection Rules (Authoritative)

When a player disconnects or leaves mid-game, backend must immediately reconcile game and round state.

### 12.1 Global principles

- Recompute active players, turn order, and round pointers immediately.
- Keep these consistent:
  - `turnIndex`
  - `activePlayers`
  - `currentBet`
  - `firstBetPlayerId`
  - `lastBetPlayerId`
  - `passCount`
- Emit updated state/events after reconciliation.

### 12.2 Leave before first bet in round

Condition:

- player leaves during initial turn window and `currentBet == null`

Behavior:

- terminate current round context
- start fresh round:
  - `pile = []`
  - `currentBet = null`
  - `passCount = 0`
  - `firstBetPlayerId = null`
  - `lastBetPlayerId = null`
- set turn to next eligible active player

### 12.3 Round in progress, leaver is current turn

Condition:

- `currentBet != null` and leaver is current turn player

Behavior:

- skip that turn
- continue round without interruption
- advance to next eligible active player
- preserve current round context (`currentBet`, `lastBetPlayerId`, `pile`)

### 12.4 Leaver is last bettor before pass loop returns

Condition:

- leaver is `lastBetPlayerId`
- turn has not yet returned to them to complete pass-loop flow

Behavior:

- terminate current round
- start fresh round:
  - `pile = []`
  - `currentBet = null`
  - `passCount = 0`
  - `firstBetPlayerId = null`
  - `lastBetPlayerId = null`
- new turn starts at next eligible active player

### 12.5 Immediate game end for 2-active-player case

Condition:

- exactly two active players with cards remained
- one of those two leaves

Behavior:

- end game immediately
- emit `game_end`
- compute final ranking from current resolved state

### 12.6 Ranking integrity

- Assign ranking only to players who stayed until hand became empty.
- Players already in `finishedPlayers` may leave later without affecting ranking or flow.

### 12.7 Emission and consistency contract

After disconnection reconciliation, backend must emit proper state transition events (`turn_update`, `round_reset`, `game_end`) so clients render authoritative results without local inference.