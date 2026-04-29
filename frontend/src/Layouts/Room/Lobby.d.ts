import type { ComponentType } from 'react'

type LobbyUser = {
  playerId: string
  socketId: string
  name: string
  characterIndex: number
  connected: boolean
  disconnectedAt: number
}

type LobbyRoomState = {
  id: string
  hostSocketId: string
  capacity: number
  status: string
  turnSeconds: number
  totalCards: number
  users: LobbyUser[]
}

type LobbyMessage = {
  socketId: string
  name: string
  message: string
  sentAt: number
}

export const Lobby: ComponentType<{
  room: LobbyRoomState
  lastMessage: LobbyMessage | null
  /** Fires avatar tooltip for in-game actions (play / pass / call). */
  gameActionToast?: { id: number; playerId: string; text: string } | null
  currentTurnPlayerId?: string
  turnSecondsLeft?: number
  gameEnded?: boolean
  playerCardCounts?: Record<string, number>
  canEditProfile?: boolean
  myPlayerId?: string
  onEditProfile?: (user: LobbyUser) => void
}>
