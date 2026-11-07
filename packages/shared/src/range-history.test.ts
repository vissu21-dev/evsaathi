import { describe, expect, it } from 'vitest';
import { estimateRangeWithHistory, historyWeightedEfficiency } from './range-history';

describe('history-weighted efficiency', () => {
  it('falls back to catalog with no samples', () => {
    const m = historyWeightedEfficiency({
      catalogWhPerKm: 185,
      samples: [],
    });
    expect(m.efficiencyWhPerKm).toBe(185);
    expect(m.historyWhPerKm).toBeNull();
    expect(m.historyWeight).toBe(0);
    expect(m.data_label).toBe('estimated');
  });

  it('blends toward observed when distance mass is large', () => {
    const m = historyWeightedEfficiency({
      catalogWhPerKm: 185,
      samples: [
        { whPerKm: 160, distanceKm: 120, ageDays: 2 },
        { whPerKm: 155, distanceKm: 100, ageDays: 5 },
      ],
    });
    expect(m.historyWhPerKm).toBeLessThan(185);
    expect(m.efficiencyWhPerKm).toBeLessThan(185);
    expect(m.efficiencyWhPerKm).toBeGreaterThan(150);
    expect(m.historyWeight).toBeGreaterThan(0.4);
  });

  it('recent samples outweigh stale ones', () => {
    const m = historyWeightedEfficiency({
      catalogWhPerKm: 185,
      samples: [
        { whPerKm: 220, distanceKm: 80, ageDays: 120 },
        { whPerKm: 150, distanceKm: 80, ageDays: 1 },
      ],
    });
    expect(m.historyWhPerKm!).toBeLessThan(185);
  });

  it('estimateRangeWithHistory attaches efficiency model', () => {
    const r = estimateRangeWithHistory({
      socPercent: 80,
      usableKwh: 72.68,
      catalogWhPerKm: 185,
      samples: [{ whPerKm: 170, distanceKm: 200, ageDays: 3 }],
    });
    expect(r.data_label).toBe('estimated');
    expect(r.efficiency_model.sampleCount).toBe(1);
    expect(r.rangeKm).toBeGreaterThan(0);
  });
});
