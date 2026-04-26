export type RoomUser = {
  socketId: string
  name: string
  characterIndex: number
}

export type RoomState = {
  id: string
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
