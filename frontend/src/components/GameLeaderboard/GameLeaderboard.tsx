import { useMemo } from 'react'
import { Box, Typography } from '@mui/material'
import { getCharacterCount, getCharacterImageUrlByIndex } from '../../assets/characters/characterImageSources'
import { theme1 } from '../../theme/theme1'
import './GameLeaderboard.css'

export type GameLeaderboardUser = {
  playerId: string
  name: string
  characterIndex: number
}

export type GameLeaderboardProps = {
  ranking: string[]
  nameBySocketId: Record<string, string>
  playerNamesFromGame?: Record<string, string>
  /** Room users in play — used to show character avatars when socket matches. */
  users?: GameLeaderboardUser[]
  /** Ribbon title (default: LEADERBOARD) */
  title?: string
}

const ROW_BEM: readonly ['1', '2', '3', '4', '5', '6', '7', '8'] = [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
]

function rowClassForIndex(index: number): string {
  const key = index < 8 ? ROW_BEM[index] : '9p'
  return `game-lb__row--${key}`
}

function labelFor(
  socketId: string,
  nameBySocketId: Record<string, string>,
  playerNamesFromGame?: Record<string, string>,
): string {
  return playerNamesFromGame?.[socketId] ?? nameBySocketId[socketId] ?? socketId
}

function resolveAvatarUrl(users: GameLeaderboardUser[] | undefined, socketId: string, themeId: string): string {
  const u = users?.find((x) => x.playerId === socketId)
  if (!u) return ''
  const n = getCharacterCount(themeId)
  if (n <= 0) return ''
  const idx = Math.min(Math.max(0, u.characterIndex), n - 1)
  return getCharacterImageUrlByIndex(themeId, idx) ?? ''
}

export function GameLeaderboard({
  ranking,
  nameBySocketId,
  playerNamesFromGame,
  users,
  title = 'LEADERBOARD',
}: GameLeaderboardProps) {
  const characterTheme = theme1.pokerFelt.green.characterFolder

  const entries = useMemo(
    () =>
      ranking.map((socketId, index) => ({
        socketId,
        name: labelFor(socketId, nameBySocketId, playerNamesFromGame),
        rank: index + 1,
        avatarUrl: resolveAvatarUrl(users, socketId, characterTheme),
      })),
    [ranking, nameBySocketId, playerNamesFromGame, users, characterTheme],
  )

  if (entries.length === 0) {
    return (
      <Box className="game-lb" component="section" aria-label="Final ranking">
        <Box className="game-lb__ribbon" aria-hidden>
          <div className="game-lb__ribbon-inner">
            <Typography className="game-lb__title" component="h2" variant="h6">
              {title}
            </Typography>
          </div>
        </Box>
        <Box className="game-lb__panel">
          <p className="game-lb__empty">No ranking data for this game yet.</p>
        </Box>
      </Box>
    )
  }

  return (
    <Box className="game-lb" component="section" aria-label="Final ranking">
      <Box className="game-lb__ribbon" aria-hidden>
        <div className="game-lb__ribbon-inner">
          <Typography className="game-lb__title" component="h2" variant="h6">
            {title}
          </Typography>
        </div>
      </Box>
      <Box className="game-lb__panel">
        <ol className="game-lb__list">
          {entries.map((row, i) => (
            <li key={row.socketId} className={`game-lb__row ${rowClassForIndex(i)}`}>
              <span className="game-lb__rank" aria-hidden>
                {row.rank}
              </span>
              <span className="game-lb__player">
                {row.avatarUrl ? (
                  <img
                    className="game-lb__avatar"
                    src={row.avatarUrl}
                    alt=""
                    width={36}
                    height={36}
                    draggable={false}
                  />
                ) : (
                  <span className="game-lb__avatar game-lb__avatar--ph" aria-hidden>
                    {row.name.charAt(0).toUpperCase() || '?'}
                  </span>
                )}
                <span className="game-lb__name" title={row.name}>
                  {row.name}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </Box>
    </Box>
  )
}
