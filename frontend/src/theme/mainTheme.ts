import { createTheme, type Theme } from '@mui/material/styles'
import { theme1, type Theme1Felt } from './theme1'

function createPokerMuiTheme(felt: Theme1Felt): Theme {
  const f = theme1.pokerFelt[felt]
  return createTheme({
    typography: { fontFamily: 'inherit' },
    cssVariables: true,
    palette: {
      mode: 'dark',
      background: {
        default: f.fallback,
        paper: 'rgba(20, 20, 20, 0.35)',
      },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          /**
           * Use `html, :root` and match `:root` specificity so we win over
           * any global :root `background` in index.css. 100% height on
           * the root is unreliable; dvh/svh fills the viewport.
           */
          'html, :root': {
            minHeight: '100dvh',
            backgroundColor: f.fallback,
            backgroundImage: f.appBackground,
            backgroundRepeat: 'no-repeat',
            backgroundSize: 'cover',
            backgroundPosition: '50% 50%',
          },
          body: {
            minHeight: '100dvh',
            margin: 0,
            backgroundColor: 'transparent',
            backgroundImage: 'none',
          },
        },
      },
    },
  })
}

/**
 * MUI theme instances mapped from `theme1` (red / green felt).
 * Pick one: `mainTheme.red` or `mainTheme.green`.
 */
export const mainTheme = {
  red: createPokerMuiTheme('red'),
  green: createPokerMuiTheme('green'),
} as const

export function createMainTheme(felt: Theme1Felt): Theme {
  return createPokerMuiTheme(felt)
}

export type { Theme1Felt } from './theme1'
