/**
 * The customer app's design language.
 *
 * Not a white dashboard: a warm, editorial loyalty wallet. A cream canvas,
 * espresso ink, and three accents that each mean something — saffron for
 * points and progress, terracotta for expiry and attention, forest for
 * positive/store actions. Fraunces sets the display voice; Manrope carries
 * the interface. The same palette is shared by every customer screen so
 * nothing drifts.
 */
export const colors = {
  /** The page: warm paper, never pure white. */
  background: '#F6F1E7',
  /** Cards sitting on the page. */
  card: '#FFFCF6',
  /** A quieter inset panel. */
  surface: '#EFE7D7',
  /** The page in the store's own colour, used sparingly. */
  tint: '#F1E9DA',

  text: '#1A1712',
  ink: '#1A1712',
  muted: '#6E675B',
  line: '#E4DAC8',
  lineStrong: '#D3C6AE',

  /** The hero and primary action colour. */
  espresso: '#241E18',
  espressoSoft: '#3A3128',
  onEspresso: '#FBF5E8',

  /** Brand green, now an accent rather than the whole page. */
  green: '#1F5C3A',
  greenDark: '#184A2F',
  greenSoft: '#E3EDE3',
  onGreen: '#FFFCF6',

  /** Points, progress, "ready". */
  saffron: '#E8A93C',
  saffronInk: '#7A5410',
  saffronSoft: '#FBF0D8',

  /** Expiry, attention. */
  terracotta: '#C25E3D',
  terracottaInk: '#8A3A22',
  terracottaSoft: '#F8E4DA',

  sage: '#8FA98C',
  sageSoft: '#E7EDE4',

  danger: '#B42318',
  dangerSoft: '#FBE3DD',
  info: '#2B5FB4',
  infoSoft: '#E5EDF9',

  // Legacy names kept so untouched screens still inherit the palette.
  gold: '#1F5C3A',
  goldSoft: '#E3EDE3',
};

export const fonts = {
  /** Headlines, balances, the wordmark. */
  display: 'Fraunces_700Bold',
  displayMedium: 'Fraunces_600SemiBold',
  body: 'Manrope_400Regular',
  bodyMedium: 'Manrope_500Medium',
  bodySemi: 'Manrope_600SemiBold',
  bodyBold: 'Manrope_700Bold',
  bodyExtra: 'Manrope_800ExtraBold',
};

export const layout = {
  screen: 20,
  radius: 22,
  cardRadius: 20,
  gap: 12,
  tabBar: 88,
};

export const formatPoints = (value: number): string => value.toLocaleString('fi-FI');
