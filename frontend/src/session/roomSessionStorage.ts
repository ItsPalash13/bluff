/** Local persistence key for room-scoped reconnect identity (matches CreateNJoin/Room flows). */
export function roomSessionStorageKey(roomId: string): string {
  return `bluff:session:${roomId.trim().toUpperCase()}`
}
