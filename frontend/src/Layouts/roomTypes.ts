export type RoomUser = {
  playerId: string
  socketId: string
  name: string
  characterIndex: number
  connected: boolean
  disconnectedAt: number
}

export type RoomState = {
  id: string
  version: number
  hostSocketId: string
  capacity: number
  status: string
  turnSeconds: number
  totalCards: number
  users: RoomUser[]
}

export type RoomMessage = {
  socketId: string
  name: string
  message: string
  sentAt: number
}

export type RoomSession = {
  room: RoomState
  name: string
  playerId: string
}

export type GameCard = {
  id: string
  rank: string
  suit: string
}

export type GameBet = {
  rank: string
  count: number
  playerId: string
}

export type BluffResultPayload = {
  callerId: string
  targetId: string
  /** Display name for the player who called Open (server-authoritative when present). */
  callerName?: string
  callerCharacterIndex?: number
  /** Display name for the last bettor (server-authoritative when present). */
  targetName?: string
  targetCharacterIndex?: number
  bluffCaught: boolean
  pileReceiver: string
  lastPlayedCards: GameCard[]
  claimedRank: string
  claimedCount: number
}

export type TurnUpdatePayload = {
  roomId: string
  status: string
  currentPlayerId: string
  /** -1 when room has no per-turn timer (turnSeconds === 0). */
  secondsLeft: number
  currentBet: GameBet | null
  pileCount: number
  lastBetPlayerId: string
  firstBetPlayerId: string
  passCount: number
  finishedPlayers: string[]
  playerCardCounts: Record<string, number>
  yourPlayerId: string
  yourHand: GameCard[]
}
