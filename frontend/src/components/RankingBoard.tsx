import { Box, Paper, Typography } from '@mui/material'

type RankingBoardProps = {
  ranking: string[]
  nameBySocketId: Record<string, string>
}

export function RankingBoard({ ranking, nameBySocketId }: RankingBoardProps) {
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
              <Typography className="ranking-name">{nameBySocketId[socketId] ?? socketId}</Typography>
            </Box>
          ))}
        </Box>
      )}
    </Paper>
  )
}
