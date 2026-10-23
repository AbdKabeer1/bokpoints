/**
 * One small palette and a few shared styles, so the screens do not drift.
 *
 * The customer app is white and green: white space first, one confident
 * green for actions and the brand mark, near-black text, and soft mint
 * surfaces for quiet cards. Green reads as "points, growth, money" without
 * shouting, and white keeps the QR and the balances legible in a hand.
 *
 * The `gold` names are kept as aliases so every existing screen picks up the
 * new brand in one place instead of being rethemed screen by screen.
 */
export const colors = {
  background: '#ffffff',
  surface: '#f5faf7',
  card: '#ffffff',
  text: '#0f1512',
  ink: '#0f1512',
  muted: '#5f6b64',
  line: '#e3eae5',

  green: '#0b7a4b',
  greenDark: '#075c38',
  greenSoft: '#e7f6ee',
  onGreen: '#ffffff',

  danger: '#b42318',
  dangerSoft: '#fdecea',

  // Legacy names: the brand is now green.
  gold: '#0b7a4b',
  goldSoft: '#e7f6ee',
};

export const layout = {
  screen: 24,
  radius: 18,
};
