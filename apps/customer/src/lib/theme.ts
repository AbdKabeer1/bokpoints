/**
 * The customer app's design language — rebuilt around clarity and colour
 * rather than cream and serif: a cool light canvas, white cards, violet as
 * the one brand action, mint for points, amber for expiry, coral for
 * attention. Manrope everywhere, no display face.
 */
export const colors = {
  background: '#F5F6FA',
  surface: '#FFFFFF',
  card: '#FFFFFF',
  tint: '#EEECFF',

  text: '#11131A',
  ink: '#11131A',
  muted: '#6B7280',
  line: '#E6E8EF',
  lineStrong: '#D6DAE5',

  primary: '#5B4BFF',
  primaryDark: '#4436E0',
  primarySoft: '#EEECFF',
  onPrimary: '#FFFFFF',

  green: '#00A878',
  greenDark: '#00805B',
  greenSoft: '#E6F8F1',
  onGreen: '#FFFFFF',

  mint: '#00C48C',
  mintSoft: '#E6F9F2',

  amber: '#F5A524',
  amberSoft: '#FFF4E0',
  amberInk: '#8A5A00',

  danger: '#E5484D',
  dangerSoft: '#FFECEC',
  info: '#2F6BFF',
  infoSoft: '#EAF0FF',

  dark: '#14151C',
  onDark: '#F7F8FB',
  darkSoft: '#23252F',

  // Legacy aliases so untouched screens inherit the new palette.
  espresso: '#14151C',
  espressoSoft: '#23252F',
  onEspresso: '#F7F8FB',
  cream: '#F5F6FA',
  saffron: '#F5A524',
  saffronInk: '#8A5A00',
  saffronSoft: '#FFF4E0',
  terracotta: '#FF6B6B',
  terracottaInk: '#B42318',
  terracottaSoft: '#FFECEC',
  sage: '#9AA3B2',
  sageSoft: '#EEF1F6',
  gold: '#5B4BFF',
  goldSoft: '#EEECFF',
};

export const fonts = {
  display: 'Manrope_800ExtraBold',
  displayMedium: 'Manrope_700Bold',
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
  tabBar: 84,
};

export const formatPoints = (value: number): string => value.toLocaleString('fi-FI');
