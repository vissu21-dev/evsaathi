import { describe, expect, it } from 'vitest';
import {
  estimateChargeCost,
  estimateChargeTime,
  estimateRange,
  estimateTripEnergy,
  resolveUsableKwh,
} from '@evsaathi/shared';

/** API-facing regression: same formulas used by /range, /costs/estimate, /trips/plan */

describe('API math contracts', () => {
  it('XEV 9S Pack 3 usable resolution', () => {
    const u = resolveUsableKwh({
      battery_kwh_stated: 79,
      battery_kwh_usable: 72.68,
      usable_equals_stated: false,
    });
    expect(u.assumed).toBe(false);
    expect(u.usableKwh).toBe(72.68);
  });

  it('range at 60% SOC ~ highway', () => {
    const r = estimateRange({
      socPercent: 60,
      usableKwh: 72.68,
      efficiencyWhPerKm: 185,
    });
    expect(r.data_label).toBe('estimated');
    expect(r.rangeKm).toBeGreaterThan(200);
    expect(r.rangeKm).toBeLessThan(280);
  });

  it('public DC session cost', () => {
    const c = estimateChargeCost({
      energyKwh: 40,
      energyRatePaisePerKwh: 2100,
    });
    expect(c.totalCostInr).toBe(840);
  });

  it('trip energy Mumbai-Pune heuristic distance', () => {
    const t = estimateTripEnergy({
      distanceKm: 150 * 1.25,
      socStartPercent: 80,
      targetSocArrivalPercent: 20,
      usableKwh: 72.68,
      efficiencyWhPerKm: 185,
      cabinAcWhPerKm: 15,
    });
    expect(t.data_label).toBe('estimated');
    expect(t.energyKwhEst).toBeGreaterThan(30);
  });

  it('charge time 20→80 on 60 kW', () => {
    const t = estimateChargeTime({
      socStart: 20,
      socTarget: 80,
      usableKwh: 72.68,
      chargerKw: 60,
    });
    expect(t.durationMin).toBeGreaterThan(30);
    expect(t.durationMin).toBeLessThan(60);
  });
});
