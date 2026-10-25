import { vi } from 'vitest';

// Screen tests run in Node/jsdom. Native SVG's CJS entry requires Flow-native
// modules, so use semantic SVG tags while browser/native builds render real art.
vi.mock('react-native-svg', () => ({
  default: 'svg',
  Circle: 'circle',
  ClipPath: 'clipPath',
  Defs: 'defs',
  Ellipse: 'ellipse',
  G: 'g',
  Image: 'image',
  Line: 'line',
  LinearGradient: 'linearGradient',
  Mask: 'mask',
  Path: 'path',
  Polygon: 'polygon',
  Polyline: 'polyline',
  RadialGradient: 'radialGradient',
  Rect: 'rect',
  Stop: 'stop',
  Symbol: 'symbol',
  Text: 'text',
  TSpan: 'tspan',
  Use: 'use',
}));
