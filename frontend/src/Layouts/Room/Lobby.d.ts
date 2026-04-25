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
  currentTurnPlayerId?: string
  turnSecondsLeft?: number
  gameEnded?: boolean
}>
