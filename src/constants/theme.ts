export const colors = {
  ink: '#14213D',
  inkMuted: '#3D4F6F',
  paper: '#F3F6FA',
  paperElevated: '#FFFFFF',
  line: '#D5DEEA',
  teal: '#0F766E',
  tealSoft: '#CCFBF1',
  amber: '#B45309',
  amberSoft: '#FEF3C7',
  rose: '#BE123C',
  roseSoft: '#FFE4E6',
  success: '#047857',
  successSoft: '#D1FAE5',
  overlay: 'rgba(20, 33, 61, 0.45)',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const radii = {
  sm: 8,
  md: 12,
  lg: 18,
  pill: 999,
};

export const typography = {
  brand: {
    fontFamily: 'LibreBaskerville_700Bold',
    fontSize: 34,
    lineHeight: 42,
    letterSpacing: -0.5,
  },
  h1: {
    fontFamily: 'LibreBaskerville_700Bold',
    fontSize: 28,
    lineHeight: 36,
  },
  h2: {
    fontFamily: 'DMSans_700Bold',
    fontSize: 20,
    lineHeight: 28,
  },
  h3: {
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 16,
    lineHeight: 22,
  },
  body: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 15,
    lineHeight: 22,
  },
  bodyStrong: {
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 15,
    lineHeight: 22,
  },
  caption: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    lineHeight: 18,
  },
  label: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.4,
    textTransform: 'uppercase' as const,
  },
};
