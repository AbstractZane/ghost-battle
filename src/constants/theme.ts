export const colors = {
  background: '#07090D',
  surface: '#0E1218',
  surfaceRaised: '#151A22',
  surfaceStrong: '#1A202A',
  border: '#252C37',
  borderStrong: '#3A4351',
  primary: '#8B5CF6',
  primaryBright: '#A78BFA',
  primaryMuted: '#2B1F46',
  cyan: '#41D9F7',
  cyanMuted: '#16333C',
  warning: '#FFB547',
  danger: '#FF5D68',
  text: '#F7F8FA',
  textMuted: '#A3ADBA',
  textSubtle: '#737E8C',
  white: '#FFFFFF',
  overlay: 'rgba(3, 5, 8, 0.78)',
  glass: 'rgba(14, 18, 24, 0.78)',
  glassStrong: 'rgba(10, 13, 18, 0.94)',
  glassBorder: 'rgba(226, 232, 240, 0.13)',
  glassHighlight: 'rgba(255, 255, 255, 0.06)',
  violet: '#8B5CF6',
  success: '#68E5A2',
  transparent: 'transparent',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  smd: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  xxxl: 64,
} as const;

export const radius = { sm: 6, md: 10, lg: 16, xl: 24, pill: 999 } as const;

export const shadows = {
  glass: '0 24px 72px rgba(0, 0, 0, 0.42)',
  floating: '0 14px 38px rgba(0, 0, 0, 0.34)',
  ranked: '0 22px 72px rgba(139, 92, 246, 0.16)',
  hover: '0 16px 42px rgba(0, 0, 0, 0.32)',
} as const;

export const breakpoints = { phone: 480, tablet: 720, desktop: 1024, wide: 1280 } as const;

export const layout = {
  contentMaxWidth: 1200,
  readingMaxWidth: 720,
  desktopSidebarWidth: 232,
} as const;

export const typography = {
  display: { fontSize: 52, lineHeight: 56, fontWeight: '900' as const, letterSpacing: -2.1 },
  hero: { fontSize: 44, lineHeight: 48, fontWeight: '900' as const, letterSpacing: -1.7 },
  title: { fontSize: 30, lineHeight: 35, fontWeight: '800' as const, letterSpacing: -0.8 },
  heading: { fontSize: 20, lineHeight: 26, fontWeight: '800' as const, letterSpacing: -0.2 },
  body: { fontSize: 16, fontWeight: '500' as const, lineHeight: 24 },
  small: { fontSize: 14, fontWeight: '500' as const, lineHeight: 21 },
  label: { fontSize: 11, fontWeight: '800' as const, letterSpacing: 1.25 },
  number: {
    fontSize: 38,
    lineHeight: 42,
    fontWeight: '900' as const,
    letterSpacing: -1.2,
    fontVariant: ['tabular-nums'] as 'tabular-nums'[],
  },
} as const;

export const motion = {
  pressMs: 120,
  hoverMs: 180,
  contentMs: 240,
} as const;
