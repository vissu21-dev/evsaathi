import { describe, expect, it } from 'vitest';
import {
  computeBatteryHealth,
  computeReputationScore,
  checkEntitlement,
  stubActivateSubscription,
  BATTERY_HEALTH_GATES,
  dailyPostCap,
} from '@evsaathi/shared';

describe('Phase 4 community moderation basics', () => {
  it('reputation gates daily post caps for newcomers vs trusted', () => {
    expect(dailyPostCap(0)).toBeLessThanOrEqual(5);
    expect(dailyPostCap(30)).toBeGreaterThan(dailyPostCap(0));
    expect(dailyPostCap(150)).toBeGreaterThanOrEqual(50);
  });

  it('spam/reject penalties lower reputation used by moderation', () => {
    const clean = computeReputationScore({
      events: [],
      verifiedReportCount: 5,
      helpfulPostCount: 4,
      usefulVotesReceived: 8,
    });
    const flagged = computeReputationScore({
      events: [],
      verifiedReportCount: 5,
      helpfulPostCount: 4,
      usefulVotesReceived: 8,
      rejectedCount: 1,
      spamFlags: 2,
    });
    expect(flagged.score).toBeLessThan(clean.score);
    expect(flagged.components.penalties).toBeGreaterThan(0);
  });
});

describe('Phase 4 battery health uncertainty gates', () => {
  it('never returns numeric SOH under min session gate', () => {
    const r = computeBatteryHealth({
      catalogUsableKwh: 72.68,
      sessionCount: BATTERY_HEALTH_GATES.minSessions - 1,
      samples: Array.from({ length: 10 }, (_, i) => ({
        observed_at: new Date(Date.now() - i * 86400000 * 4).toISOString(),
        inferred_usable_kwh: 70,
        source: 'manual',
      })),
      historySpanDays: 60,
    });
    expect(r.soh_percent).toBeNull();
    expect(r.display.show_numeric_soh).toBe(false);
    expect(r.gates.sessions_met).toBe(false);
  });

  it('bounded estimate includes uncertainty band when gated data present', () => {
    const r = computeBatteryHealth({
      catalogUsableKwh: 72.68,
      sessionCount: 12,
      historySpanDays: 45,
      samples: Array.from({ length: 8 }, (_, i) => ({
        observed_at: new Date(Date.now() - i * 5 * 86400000).toISOString(),
        inferred_usable_kwh: 69 + i * 0.2,
        efficiency_wh_per_km: 170,
        source: 'manual',
      })),
    });
    expect(r.status).toBe('bounded_estimate');
    expect(r.uncertainty_pp).toBeGreaterThan(0);
    expect(r.soh_low_percent!).toBeLessThanOrEqual(r.soh_percent!);
  });
});

describe('Phase 4 subscriptions + partnership honesty', () => {
  it('stub checkout never claims a real payment provider', () => {
    const r = stubActivateSubscription('family');
    expect(r.payment_provider).toBe('stub');
    expect(r.note).toMatch(/stub|No UPI/i);
  });

  it('fleet entitlement denied on free tier', () => {
    expect(checkEntitlement('free', 'fleet_dashboard').allowed).toBe(false);
    expect(checkEntitlement('fleet', 'business_exports').allowed).toBe(true);
  });
});
