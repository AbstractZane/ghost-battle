/** No environment flag can enable this on a release build or a hosted website. */
export function soloLocalMode(dev: boolean, solo: boolean, hostname?: string): boolean {
  return dev && solo && (hostname === 'localhost' || hostname === '127.0.0.1');
}
