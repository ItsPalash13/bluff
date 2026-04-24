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
  currentName: string
  lastMessage: LobbyMessage | null
  commentOpen: boolean
  onCommentToggle: (open: boolean) => void
  onLeave: () => void
}>
