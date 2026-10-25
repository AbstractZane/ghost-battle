export interface StudioIdentity {
  name: string;
  photoUri: string | null;
}

/** Local filming identities only; never changes an online account or public profile. */
export interface StudioProfiles {
  version: 1;
  player: StudioIdentity;
  opponent: StudioIdentity;
}

export function defaultStudioProfiles(playerName: string, opponentName = 'Rival'): StudioProfiles {
  return {
    version: 1,
    player: { name: playerName.trim().slice(0, 32) || 'You', photoUri: null },
    opponent: { name: opponentName.trim().slice(0, 32) || 'Rival', photoUri: null },
  };
}

export function parseStudioProfiles(value: unknown): StudioProfiles | null {
  if (!value || typeof value !== 'object') return null;
  const profiles = value as Partial<StudioProfiles>;
  if (profiles.version !== 1) return null;
  const identity = (value: unknown): StudioIdentity | null => {
    if (!value || typeof value !== 'object') return null;
    const item = value as Partial<StudioIdentity>;
    if (
      typeof item.name !== 'string' ||
      !item.name.trim() ||
      item.name.length > 32 ||
      (item.photoUri !== null &&
        (typeof item.photoUri !== 'string' ||
          !(
            item.photoUri.startsWith('file://') ||
            /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(item.photoUri)
          )))
    )
      return null;
    return { name: item.name.trim(), photoUri: item.photoUri };
  };
  const player = identity(profiles.player);
  const opponent = identity(profiles.opponent);
  return player && opponent ? { version: 1, player, opponent } : null;
}
