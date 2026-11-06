import { describe, expect, it } from 'vitest';
import {
  energyAtSoc,
  estimateChargeCost,
  estimateChargeTime,
  estimateRange,
  estimateTripEnergy,
  haversineKm,
  kwhPer100Km,
  kwhPerKm,
  resolveUsableKwh,
  theoreticalRangeKm,
} from './math';

describe('range math', () => {
  it('computes energy at SOC', () => {
    expect(energyAtSoc(72.68, 50)).toBeCloseTo(36.34, 2);
  });

  it('computes kWh/km and /100km', () => {
    expect(kwhPerKm(17.2, 100)).toBeCloseTo(0.172, 3);
    expect(kwhPer100Km(17.2, 100)).toBeCloseTo(17.2, 1);
  });

  it('theoretical range from usable energy + efficiency', () => {
    // 36.34 kWh / 0.18 kWh/km = 201.9 km
    expect(theoreticalRangeKm(36.34, 180)).toBeCloseTo(201.9, 0);
  });

  it('estimateRange labels estimated and applies reserve', () => {
    const r = estimateRange({
      socPercent: 80,
      usableKwh: 72.68,
      efficiencyWhPerKm: 180,
      safetyReservePercent: 10,
    });
    expect(r.data_label).toBe('estimated');
    expect(r.rangeKm).toBeGreaterThan(r.rangeKmWithReserve);
    expect(r.confidence).toBeGreaterThan(50);
    expect(r.assumptions.length).toBeGreaterThan(0);
  });

  it('does not silently equate stated to usable', () => {
    const a = resolveUsableKwh({ battery_kwh_stated: 79 });
    expect(a.assumed).toBe(true);
    expect(a.usableKwh).toBeCloseTo(79 * 0.92, 2);

    const b = resolveUsableKwh({
      battery_kwh_stated: 79,
      usable_equals_stated: true,
    });
    expect(b.assumed).toBe(false);
    expect(b.usableKwh).toBe(79);
  });
});

describe('charge cost math', () => {
  it('computes session cost in paise/INR', () => {
    const c = estimateChargeCost({
      energyKwh: 30,
      energyRatePaisePerKwh: 1800, // ₹18/kWh
      sessionFeePaise: 500,
    });
    expect(c.energyCostPaise).toBe(54000);
    expect(c.sessionFeePaise).toBe(500);
    expect(c.totalCostPaise).toBe(54500);
    expect(c.totalCostInr).toBe(545);
    expect(c.data_label).toBe('estimated');
  });

  it('applies home charging loss factor', () => {
    const c = estimateChargeCost({
      energyKwh: 10,
      energyRatePaisePerKwh: 800,
      lossFactor: 1.08,
    });
    expect(c.energyKwhFromGrid).toBeCloseTo(10.8, 2);
    expect(c.energyCostPaise).toBe(Math.round(10.8 * 800));
  });
});

describe('trip energy math', () => {
  it('estimates Mumbai→Pune style hop', () => {
    const t = estimateTripEnergy({
      distanceKm: 150,
      socStartPercent: 70,
      targetSocArrivalPercent: 20,
      usableKwh: 72.68,
      efficiencyWhPerKm: 180,
      cabinAcWhPerKm: 15,
      safetyReservePercent: 10,
    });
    expect(t.data_label).toBe('estimated');
    expect(t.energyKwhEst).toBeCloseTo((195 / 1000) * 150, 2);
    expect(t.destSocPercent).toBeLessThan(70);
    expect(t.disclaimer).toMatch(/not guaranteed/i);
  });

  it('flags charge needed when dest SOC below target+reserve', () => {
    const t = estimateTripEnergy({
      distanceKm: 400,
      socStartPercent: 50,
      targetSocArrivalPercent: 20,
      usableKwh: 72.68,
      efficiencyWhPerKm: 180,
    });
    expect(t.needsCharge).toBe(true);
    expect(t.chargeKwhNeeded).toBeGreaterThan(0);
  });
});

describe('charge time', () => {
  it('estimates DC charge duration with taper', () => {
    const t = estimateChargeTime({
      socStart: 20,
      socTarget: 80,
      usableKwh: 72.68,
      chargerKw: 60,
    });
    expect(t.energyKwh).toBeCloseTo(energyAtSoc(72.68, 60), 1);
    expect(t.durationMin).toBeGreaterThan(20);
    expect(t.data_label).toBe('estimated');
  });
});

describe('geo', () => {
  it('haversine Mumbai–Pune roughly 120–160 km', () => {
    const d = haversineKm(
      { lat: 19.076, lng: 72.877 },
      { lat: 18.52, lng: 73.856 },
    );
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(170);
  });
});
