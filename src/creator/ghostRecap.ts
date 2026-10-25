export interface GhostRun {
  version: 1;
  playerRepTimesMs: number[];
  practice: boolean;
  interruptions: number;
}
export interface GhostRaceRecap {
  version: 1;
  headline: string;
  practice: boolean;
  target: number;
  segments: { fromMs: number; toMs: number; lead: -1 | 0 | 1 }[];
}
const stamp = (at: number) =>
  `${String(Math.floor(at / 60000)).padStart(2, '0')}:${String(Math.floor(at / 1000) % 60).padStart(2, '0')}`;
export function buildGhostRecap(
  run: GhostRun,
  ghostTimes: readonly number[],
  durationMs: number,
): GhostRaceRecap {
  const events = new Map<number, [number, number]>();
  for (const [times, side] of [
    [run.playerRepTimesMs, 0],
    [ghostTimes, 1],
  ] as const) {
    for (const t of new Set(times)) {
      if (!Number.isInteger(t) || t <= 0 || t > durationMs) continue;
      const e = events.get(t) ?? [0, 0];
      e[side]++;
      events.set(t, e);
    }
  }
  let difference = 0,
    from = 0,
    lead: -1 | 0 | 1 = 0;
  let lastPlayerLead: number | null = null,
    lastGhostLead: number | null = null;
  const segments: GhostRaceRecap['segments'] = [];
  for (const [at, [you, ghost]] of [...events].sort((a, b) => a[0] - b[0])) {
    difference += you - ghost;
    const next = Math.sign(difference) as -1 | 0 | 1;
    if (next !== lead) {
      if (at > from) segments.push({ fromMs: from, toMs: at, lead });
      if (next === 1) lastPlayerLead = at;
      if (next === -1) lastGhostLead = at;
      from = at;
      lead = next;
    }
  }
  if (from < durationMs) segments.push({ fromMs: from, toMs: durationMs, lead });
  const practice = run.practice || run.interruptions > 0;
  const headline = practice
    ? 'Practice round · paused or interrupted. Try an uninterrupted rematch.'
    : difference > 0 && lastPlayerLead !== null
      ? `You took the winning lead at ${stamp(lastPlayerLead)}.`
      : difference < 0 && lastGhostLead !== null
        ? `The ghost took the winning lead at ${stamp(lastGhostLead)}.`
        : 'You finished level. One more accepted push-up would break the tie.';
  return { version: 1, headline, practice, target: ghostTimes.length + 1, segments };
}
