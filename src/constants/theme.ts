/** Kadalas Calm File Cabinet — tokens from docs/design/stitch/DESIGN.md */

export const colors = {
  primary: '#0F5E52',
  primaryHover: '#0B4A41',
  onPrimary: '#FFFFFF',
  primaryContainer: '#DCEFEA',
  onPrimaryContainer: '#0B4A41',

  paper: '#F7F6F2',
  surface: '#FFFFFF',
  surfaceMuted: '#F1EFE9',
  border: '#E4E1D8',
  borderStrong: '#CFCBBF',

  ink: '#1C2321',
  inkMuted: '#5B6461',
  inkTertiary: '#8A918E',

  success: '#1E7A4C',
  successSoft: '#E3F3EA',
  amber: '#A35F00',
  amberSoft: '#FCEFD9',
  rose: '#B3261E',
  roseSoft: '#FBE4E2',
  info: '#2F5DA8',
  infoSoft: '#E5ECF8',

  // Back-compat aliases used across the app
  teal: '#0F5E52',
  tealSoft: '#DCEFEA',
  paperElevated: '#FFFFFF',
  line: '#E4E1D8',
  successSoftLegacy: '#E3F3EA',
  overlay: 'rgba(28, 35, 33, 0.45)',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  huge: 48,
  page: 24,
  pageMobile: 16,
};

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
};

export const layout = {
  sidebarWidth: 240,
  detailPaneMin: 420,
  detailPaneMax: 480,
  desktopBreakpoint: 900,
  denseRowDesktop: 56,
  denseRowMobile: 64,
  touchTarget: 48,
};

export const typography = {
  brand: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.3,
  },
  display: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 32,
    lineHeight: 40,
  },
  h1: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 24,
    lineHeight: 32,
  },
  h2: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 20,
    lineHeight: 28,
  },
  h3: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 16,
    lineHeight: 24,
  },
  body: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 20,
  },
  bodyStrong: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    lineHeight: 20,
  },
  bodyLg: {
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
    lineHeight: 24,
  },
  caption: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    lineHeight: 16,
  },
  label: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    lineHeight: 16,
  },
  overline: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 0.66,
    textTransform: 'uppercase' as const,
  },
  // Legacy aliases
  brandLegacy: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 34,
    lineHeight: 42,
  },
};
