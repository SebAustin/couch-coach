/**
 * "Lamplight" design tokens (docs/ux.md section 1). All sizes are design px at 1920x1080;
 * wrap them with `s()` from ./scale when styling.
 */
export const color = {
  bg: '#1B1420',
  stage: '#120D16',
  raised: '#261C2D',
  overlay: '#33263C',
  track: '#3D2E48',
  line: '#4A3A55',
  text: '#FFF4E8',
  textDim: '#CDBFD6',
  textMuted: '#A898B4',
  accent: '#B9A2FF',
  onAccent: '#1B1420',
  accentSoft: '#D9CCFF',
  focusRing: '#FFF4E8',
  focusGlow: 'rgba(185,162,255,0.55)',
  scoreGood: '#5BE3A0',
  scoreOk: '#FFC247',
  scorePoor: '#FF5C7A',
  onScore: '#1B1420',
  lampGlow: 'rgba(185,162,255,0.12)',
  scrim: 'rgba(18,13,22,0.8)',
  white: '#FFFFFF',
  ink: '#120D16',
} as const;

export const space = [0, 4, 8, 12, 16, 24, 32, 48, 64, 96] as const;
export const radius = { chip: 14, button: 22, card: 32, stage: 40, pill: 999 } as const;
export const safe = { x: 96, y: 54 } as const;
export const motion = { focus: 150, bump: 220, enter: 320 } as const;

/** Design resolution the spec is written against. */
export const DESIGN_WIDTH = 1920;
export const DESIGN_HEIGHT = 1080;

/** Font family names registered by `useLamplightFonts`. */
export const fontFamily = {
  display: 'BricolageGrotesque_800ExtraBold',
  displayBold: 'BricolageGrotesque_700Bold',
  text: 'Figtree_500Medium',
  textBold: 'Figtree_700Bold',
} as const;

/** TV type scale. No text under 26 (spec section 1). */
export const type = {
  repCounter: { fontSize: 220, lineHeight: 240, fontFamily: fontFamily.display },
  display: { fontSize: 96, lineHeight: 120, fontFamily: fontFamily.display },
  h1: { fontSize: 64, lineHeight: 80, fontFamily: fontFamily.displayBold },
  h2: { fontSize: 44, lineHeight: 56, fontFamily: fontFamily.displayBold },
  bodyL: { fontSize: 34, lineHeight: 48, fontFamily: fontFamily.text },
  body: { fontSize: 30, lineHeight: 42, fontFamily: fontFamily.text },
  bodyBold: { fontSize: 30, lineHeight: 42, fontFamily: fontFamily.textBold },
  label: { fontSize: 26, lineHeight: 34, fontFamily: fontFamily.textBold, letterSpacing: 1.04 },
} as const;
