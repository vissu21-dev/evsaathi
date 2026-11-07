import { describe, expect, it } from 'vitest';
import {
  canPostWithoutThrottle,
  computeReputationScore,
  dailyPostCap,
} from './reputation';

describe('reputation scoring', () => {
  it('starts as newcomer with empty history', () => {
    const r = computeReputationScore({ events: [] });
    expect(r.score).toBe(0);
    expect(r.tier).toBe('newcomer');
    expect(r.display_label).toMatch(/Newcomer/i);
  });

  it('rewards verified reports and helpful posts', () => {
    const r = computeReputationScore({
      events: [],
      verifiedReportCount: 4,
      helpfulPostCount: 3,
      usefulVotesReceived: 10,
    });
    expect(r.score).toBeGreaterThanOrEqual(25);
    expect(r.tier).toBe('contributor');
    expect(r.components.verified_reports).toBe(32);
  });

  it('penalizes spam and rejects', () => {
    const good = computeReputationScore({
      events: [],
      verifiedReportCount: 10,
      helpfulPostCount: 5,
    });
    const bad = computeReputationScore({
      events: [],
      verifiedReportCount: 10,
      helpfulPostCount: 5,
      rejectedCount: 2,
      spamFlags: 1,
    });
    expect(bad.score).toBeLessThan(good.score);
  });

  it('gates photo throttle by score', () => {
    expect(canPostWithoutThrottle(0)).toBe(false);
    expect(canPostWithoutThrottle(10)).toBe(true);
    expect(dailyPostCap(0)).toBe(5);
    expect(dailyPostCap(120)).toBe(50);
  });
});
