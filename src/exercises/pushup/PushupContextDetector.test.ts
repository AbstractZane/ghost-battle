import { describe, expect, it } from 'vitest';

import { PushupContextDetector } from './PushupContextDetector';

describe('PushupContextDetector', () => {
  it('requires stable entry and preserves pushup context during degraded grace', () => {
    const detector = new PushupContextDetector({
      enterConfirmationMs: 500,
      degradedGraceMs: 600,
      exitConfirmationMs: 100,
    });
    expect(detector.update(true, true, 0)).toBe('ENTERING_PUSHUP');
    expect(detector.update(true, true, 499)).toBe('ENTERING_PUSHUP');
    expect(detector.update(true, true, 500)).toBe('PUSHUP');
    expect(detector.update(false, false, 600)).toBe('UNCERTAIN');
    expect(detector.update(false, false, 1199)).toBe('UNCERTAIN');
    expect(detector.update(true, true, 1200)).toBe('PUSHUP');
  });

  it('exits only after grace and final exit confirmation', () => {
    const detector = new PushupContextDetector({
      enterConfirmationMs: 500,
      degradedGraceMs: 600,
      exitConfirmationMs: 100,
    });
    detector.update(true, true, 0);
    detector.update(true, true, 500);
    expect(detector.update(false, false, 600)).toBe('UNCERTAIN');
    expect(detector.update(false, false, 1200)).toBe('EXITING_PUSHUP');
    expect(detector.update(false, false, 1300)).toBe('NOT_PUSHUP');
  });
});
