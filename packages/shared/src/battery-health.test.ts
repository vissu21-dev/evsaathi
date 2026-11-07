import { describe, expect, it } from 'vitest';
import { BATTERY_HEALTH_GATES, computeBatteryHealth } from './battery-health';

describe('battery health uncertainty gates', () => {
  it('hides numeric SOH with sparse history (no fake 100%)', () => {
    const r = computeBatteryHealth({
      catalogUsableKwh: 72.68,
      sessionCount: 2,
      samples: [
        {
          observed_at: '2026-10-01T10:00:00Z',
          inferred_usable_kwh: 72,
          efficiency_wh_per_km: 170,
          source: 'manual',
        },
      ],
    });
    expect(r.status).toBe('insufficient_history');
    expect(r.soh_percent).toBeNull();
    expect(r.display.show_numeric_soh).toBe(false);
    expect(r.display.headline).not.toMatch(/100%/);
  });

  it('allows trend_only without inventing SOH', () => {
    const samples = Array.from({ length: 4 }, (_, i) => ({
      observed_at: new Date(Date.now() - (30 - i * 7) * 86400000).toISOString(),
      efficiency_wh_per_km: 160 + i * 2,
      source: 'manual',
    }));
    const r = computeBatteryHealth({
      catalogUsableKwh: 72.68,
      sessionCount: 5,
      samples,
    });
    expect(r.status).toBe('trend_only');
    expect(r.soh_percent).toBeNull();
    expect(r.display.show_numeric_soh).toBe(false);
    expect(r.trend.direction).not.toBe('unknown');
  });

  it('returns bounded estimate only when all gates pass', () => {
    const samples = Array.from({ length: BATTERY_HEALTH_GATES.minSamples + 2 }, (_, i) => ({
      observed_at: new Date(Date.now() - (60 - i * 5) * 86400000).toISOString(),
      inferred_usable_kwh: 70 + (i % 3) * 0.4,
      efficiency_wh_per_km: 168 + (i % 2),
      source: 'manual',
    }));
    const r = computeBatteryHealth({
      catalogUsableKwh: 72.68,
      sessionCount: BATTERY_HEALTH_GATES.minSessions,
      samples,
      historySpanDays: 55,
    });
    expect(r.status).toBe('bounded_estimate');
    expect(r.soh_percent).not.toBeNull();
    expect(r.uncertainty_pp).not.toBeNull();
    expect(r.soh_low_percent!).toBeLessThan(r.soh_percent!);
    expect(r.soh_high_percent!).toBeGreaterThan(r.soh_percent!);
    expect(r.display.show_numeric_soh).toBe(true);
    expect(r.gates.sessions_met).toBe(true);
  });

  it('documents gate thresholds', () => {
    expect(BATTERY_HEALTH_GATES.minSessions).toBeGreaterThanOrEqual(8);
    expect(BATTERY_HEALTH_GATES.minSpanDays).toBeGreaterThanOrEqual(30);
  });
});
