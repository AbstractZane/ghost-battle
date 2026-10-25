export const nameColorValues: Record<string, string> = {
  cyan: '#67E7FF',
  violet: '#BD92FF',
  gold: '#F5D584',
};

export const frameValues: Record<string, string> = {
  ice_facet: '#92EEFF',
  amethyst_edge: '#BD92FF',
  onyx_ring: '#A2A7BE',
  diamond_orbit: '#92EEFF',
  prism_shine: '#DBACFF',
  crystal_pulse: '#66E4FF',
  mint_arcade: '#91F7BD',
  sunset_pixels: '#FFB784',
  bloom_byte: '#FFA3D7',
  solar_flare: '#FFB35C',
  void_portal: '#BD92FF',
  neon_current: '#91F7BD',
};

export const animatedFrameIds = new Set([
  'diamond_orbit',
  'prism_shine',
  'crystal_pulse',
  'solar_flare',
  'void_portal',
  'neon_current',
]);
export const pixelFrameIds = new Set(['mint_arcade', 'sunset_pixels', 'bloom_byte', 'void_portal']);
export const hatIds = new Set(['forge_crown', 'moon_wizard', 'sprout_cap', 'ember_fox']);
export const animatedHatIds = new Set(['moon_wizard', 'sprout_cap']);
