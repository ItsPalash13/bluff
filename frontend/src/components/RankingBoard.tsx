import { Box, Paper, Typography } from '@mui/material'

type RankingBoardProps = {
  ranking: string[]
  /** From current room users (may miss players who left). */
  nameBySocketId: Record<string, string>
  /** Server snapshot at game start; used so leavers still show by name. */
  playerNamesFromGame?: Record<string, string>
}

export function RankingBoard({ ranking, nameBySocketId, playerNamesFromGame }: RankingBoardProps) {
  const labelFor = (socketId: string) =>
    playerNamesFromGame?.[socketId] ?? nameBySocketId[socketId] ?? socketId

  return (
    <Paper className="ranking-shell" elevation={0}>
      <Typography className="ranking-title">Final Ranking</Typography>
      {ranking.length === 0 ? (
        <Typography className="ranking-empty">Ranking is not available yet.</Typography>
      ) : (
        <Box className="ranking-list">
          {ranking.map((socketId, index) => (
            <Box key={`${socketId}-${index}`} className="ranking-row">
              <Typography className="ranking-position">#{index + 1}</Typography>
              <Typography className="ranking-name">{labelFor(socketId)}</Typography>
            </Box>
          ))}
        </Box>
      )}
    </Paper>
  )
}
