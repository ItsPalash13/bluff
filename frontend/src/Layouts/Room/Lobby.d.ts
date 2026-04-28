import type { ComponentType } from 'react'

type LobbyUser = {
  socketId: string
  name: string
  characterIndex: number
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
  gameActionToast?: { id: number; socketId: string; text: string } | null
  currentTurnPlayerId?: string
  turnSecondsLeft?: number
  gameEnded?: boolean
  playerCardCounts?: Record<string, number>
  canEditProfile?: boolean
  mySocketId?: string
  onEditProfile?: (user: LobbyUser) => void
}>
