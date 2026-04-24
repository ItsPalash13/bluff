import Avatar from '@mui/material/Avatar'
import { getCharacterImageUrl } from './characterImageSources'
import {
  getCharacterAltText,
  getCharacterKey,
  type CharacterAvatarProps,
} from './characterAvatarTypes'

export function CharacterAvatar({
  themeId,
  row,
  col,
  size = 64,
  alt,
}: CharacterAvatarProps) {
  const key = getCharacterKey(row, col)
  const src = getCharacterImageUrl(themeId, key)
  const label = alt ?? getCharacterAltText(row, col)

  return (
    <Avatar
      src={src}
      alt={label}
      variant="circular"
      slotProps={{ img: { loading: 'lazy' } }}
      sx={{
        width: size,
        height: size,
        bgcolor: 'action.hover',
        border: 1,
        borderColor: 'divider',
        boxSizing: 'border-box',
      }}
    />
  )
}
