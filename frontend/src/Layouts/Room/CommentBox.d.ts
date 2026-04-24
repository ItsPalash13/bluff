import type { ComponentType } from 'react'

export const CommentBox: ComponentType<{
  open: boolean
  onClose: () => void
  onSend: (message: string) => void
}>
