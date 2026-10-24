/**
 * The customer app's design tokens, taken from the same list as the web
 * surfaces (UIdesign brief §2), so a store's card and the merchant's
 * dashboard speak the same language. White space comes first; a store's own
 * brand colour is the only colour that varies.
 */
export const colors = {
  background: '#ffffff',
  surface: '#f5faf7',
  card: '#ffffff',
  text: '#0f1512',
  ink: '#0f1512',
  muted: '#5f6f66',
  line: '#e3ebe6',
  lineStrong: '#d4ded8',

  green: '#0b7a4b',
  greenDark: '#075c38',
  greenSoft: '#e8f4ee',
  onGreen: '#ffffff',

  amber: '#b98a1b',
  amberSoft: '#fbf1d9',
  amberInk: '#6b5000',

  danger: '#b42318',
  dangerSoft: '#fdecea',

  info: '#2b5fb4',
  infoSoft: '#e8f0fb',

  // Legacy names: the brand is green.
  gold: '#0b7a4b',
  goldSoft: '#e8f4ee',
};

export const layout = {
  screen: 20,
  radius: 18,
  cardRadius: 16,
  gap: 12,
  tabBar: 74,
};

/** Money, dates and numbers the Finnish way, without a library. */
export const formatPoints = (value: number): string => value.toLocaleString('fi-FI');
