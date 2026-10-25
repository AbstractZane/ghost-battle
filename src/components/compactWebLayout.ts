export function compactWebLayout(platform: string, width: number, height: number) {
  const compact = platform === 'web' && (width < 720 || (width < 960 && height < 500));
  return { compact, short: compact && height < 650, horizontalPadding: compact ? 12 : undefined };
}
