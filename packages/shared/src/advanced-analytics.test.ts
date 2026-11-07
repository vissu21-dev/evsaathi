import { describe, expect, it } from 'vitest';
import { computeAdvancedAnalytics } from './advanced-analytics';

describe('computeAdvancedAnalytics', () => {
  it('degrades to manual_sparse with few samples', () => {
    const r = computeAdvancedAnalytics({
      usableKwh: 79,
      telemetry: [
        {
          observed_at: '2026-11-06T10:00:00Z',
          soc_percent: 70,
          source: 'manual',
        },
      ],
      sessions: [],
    });
    expect(r.richness).toBe('manual_sparse');
    expect(r.data_label).toBe('manually_entered');
    expect(r.notes[0]).toMatch(/Sparse/);
  });

  it('marks adapter_enriched when OEM samples exist', () => {
    const r = computeAdvancedAnalytics({
      usableKwh: 79,
      telemetry: [
        { observed_at: '2026-11-06T10:00:00Z', soc_percent: 70, source: 'oem', charge_power_kw: 40 },
        { observed_at: '2026-11-06T11:00:00Z', soc_percent: 75, source: 'oem', charge_power_kw: 55 },
        { observed_at: '2026-11-06T12:00:00Z', soc_percent: 80, source: 'oem', charge_power_kw: 60 },
      ],
      sessions: [{ source: 'operator_session', started_at: '2026-11-06T10:00:00Z', energy_kwh: 12, avg_power_kw: 50, max_power_kw: 90 }],
    });
    expect(r.richness).toBe('adapter_enriched');
    expect(r.mean_charge_power_kw).toBeGreaterThan(0);
    expect(r.peak_charge_power_kw).toBe(90);
    expect(r.data_label).toBe('recently_synchronized');
  });
});
