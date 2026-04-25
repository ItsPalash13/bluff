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
