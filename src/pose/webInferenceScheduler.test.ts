import { describe, expect, it } from 'vitest';
import { WebInferenceScheduler } from './webInferenceScheduler';

describe('web inference scheduler', () => {
  it('keeps an in-flight inference locked across hide and resume', () => {
    const scheduler = new WebInferenceScheduler(20);
    expect(scheduler.tryStart(0)).toBe(true);
    scheduler.setVisible(false);
    scheduler.setVisible(true);
    expect(scheduler.tryStart(100)).toBe(false);
    scheduler.complete();
    expect(scheduler.tryStart(150)).toBe(true);
  });
  it('never overlaps inference and throttles to the requested cadence', () => {
    const scheduler = new WebInferenceScheduler(20);
    expect(scheduler.tryStart(0)).toBe(true);
    expect(scheduler.tryStart(60)).toBe(false);
    scheduler.complete();
    expect(scheduler.tryStart(20)).toBe(false);
    expect(scheduler.tryStart(50)).toBe(true);
  });

  it('pauses while hidden and resumes safely', () => {
    const scheduler = new WebInferenceScheduler(20);
    scheduler.setVisible(false);
    expect(scheduler.tryStart(0)).toBe(false);
    scheduler.setVisible(true);
    expect(scheduler.tryStart(1)).toBe(true);
  });
});
