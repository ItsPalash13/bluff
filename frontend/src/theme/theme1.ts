/**
 * theme1 — base tokens. Poker-style felt: bright center, darker toward the
 * edges (oval radial focus), for use as the app shell background.
 */
export const theme1 = {
  id: 'theme1' as const,
  /** Red and green “table” backdrops. */
  pokerFelt: {
    red: {
      /** Character pack folder under `assets/characters/imgs/`. */
      characterFolder: 'jpgs1',
      /** Card pack folder under `assets/card/png/`. */
      cardFolder: '2x',
      /** Used under gradients for overscroll / base fill. */
      fallback: '#0a0506',
      /**
       * One smooth radial (no stacked layers) so nothing tiles or seams.
       * Slight hot spot at the first stops; dark corners at the end.
       */
      appBackground:
        'radial-gradient(ellipse 150% 130% at 50% 44%, #e12e42 0%, #d62839 14%, #7a111f 48%, #2a0a0f 80%, #0a0506 100%)',
    },
    green: {
      /** Character pack folder under `assets/characters/imgs/`. */
      characterFolder: 'jpgs1',
      /** Card pack folder under `assets/card/png/`. */
      cardFolder: '2x',
      fallback: '#040a06',
      appBackground:
        'radial-gradient(ellipse 150% 130% at 50% 44%, #2abb6e 0%, #1d9a58 14%, #0c4d2a 48%, #061f12 80%, #040a06 100%)',
    },
  },
} as const

export type Theme1Felt = keyof typeof theme1.pokerFelt
