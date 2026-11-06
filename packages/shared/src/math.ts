import type {
  ChargeCostInput,
  ChargeCostResult,
  ChargeTimeInput,
  ChargeTimeResult,
  RangeEstimateInput,
  RangeEstimateResult,
  TripEnergyInput,
  TripEnergyResult,
} from './types';

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Usable energy remaining at a given SOC (kWh). */
export function energyAtSoc(usableCapacityKwh: number, socPercent: number): number {
  return usableCapacityKwh * (clamp(socPercent, 0, 100) / 100);
}

/** kWh/km from energy and distance. */
export function kwhPerKm(energyKwh: number, distanceKm: number): number {
  if (distanceKm <= 0) return 0;
  return energyKwh / distanceKm;
}

/** kWh/100km. */
export function kwhPer100Km(energyKwh: number, distanceKm: number): number {
  return kwhPerKm(energyKwh, distanceKm) * 100;
}

/**
 * Theoretical range from usable kWh and consumption.
 * Documented: range_km = usable_kwh_at_soc / (Wh_per_km / 1000)
 */
export function theoreticalRangeKm(usableKwhAtSoc: number, efficiencyWhPerKm: number): number {
  if (efficiencyWhPerKm <= 0) return 0;
  const kwhPerKmVal = efficiencyWhPerKm / 1000;
  return usableKwhAtSoc / kwhPerKmVal;
}

/**
 * Resolve usable pack kWh from catalog + overrides.
 * Never silently treat stated = usable unless usable_equals_stated or usable is set.
 */
export function resolveUsableKwh(opts: {
  battery_kwh_stated: number;
  battery_kwh_usable?: number | null;
  usable_equals_stated?: boolean;
  override_usable?: number | null;
}): { usableKwh: number; assumed: boolean; note: string } {
  if (opts.override_usable != null && opts.override_usable > 0) {
    return {
      usableKwh: opts.override_usable,
      assumed: false,
      note: 'User/vehicle override usable kWh',
    };
  }
  if (opts.battery_kwh_usable != null && opts.battery_kwh_usable > 0) {
    return {
      usableKwh: opts.battery_kwh_usable,
      assumed: false,
      note: 'Catalog usable kWh',
    };
  }
  if (opts.usable_equals_stated) {
    return {
      usableKwh: opts.battery_kwh_stated,
      assumed: false,
      note: 'Catalog flags usable_equals_stated',
    };
  }
  // Conservative Phase 1 default: 92% of stated when usable unknown — always labeled estimated
  const assumed = opts.battery_kwh_stated * 0.92;
  return {
    usableKwh: assumed,
    assumed: true,
    note: 'Usable kWh unknown — using 92% of stated (estimated, not OEM live)',
  };
}

export function estimateRange(input: RangeEstimateInput): RangeEstimateResult {
  const reserve = input.safetyReservePercent ?? 10;
  const usableAtSoc = energyAtSoc(input.usableKwh, input.socPercent);
  const usableWithReserve = energyAtSoc(input.usableKwh, Math.max(0, input.socPercent - reserve));
  const kwhKm = input.efficiencyWhPerKm / 1000;
  const rangeKm = theoreticalRangeKm(usableAtSoc, input.efficiencyWhPerKm);
  const rangeKmWithReserve = theoreticalRangeKm(usableWithReserve, input.efficiencyWhPerKm);

  // Confidence: lower if SOC extreme or efficiency is a catalog default assumption
  let confidence = 72;
  if (input.socPercent < 15 || input.socPercent > 95) confidence -= 8;
  if (input.efficiencyWhPerKm <= 0) confidence = 20;

  return {
    usableKwhAtSoc: round(usableAtSoc, 3),
    rangeKm: round(rangeKm, 1),
    rangeKmWithReserve: round(rangeKmWithReserve, 1),
    kwhPerKm: round(kwhKm, 4),
    kwhPer100Km: round(kwhKm * 100, 2),
    confidence: clamp(confidence, 0, 100),
    assumptions: [
      `Efficiency ${input.efficiencyWhPerKm} Wh/km (catalog/override — not live OEM)`,
      `Usable pack ${input.usableKwh} kWh`,
      `Safety reserve ${reserve}% SOC for reserved range`,
      'Highway/city mix not applied in base estimate',
    ],
    data_label: 'estimated',
  };
}

export function estimateChargeCost(input: ChargeCostInput): ChargeCostResult {
  const loss = input.lossFactor && input.lossFactor > 0 ? input.lossFactor : 1;
  const fromGrid = input.energyKwh * loss;
  const energyCost = Math.round(fromGrid * input.energyRatePaisePerKwh);
  const sessionFee = Math.round(input.sessionFeePaise ?? 0);
  const idle =
    input.idleMinutes && input.idleFeePaisePerMin
      ? Math.round(input.idleMinutes * input.idleFeePaisePerMin)
      : 0;
  const total = energyCost + sessionFee + idle;
  return {
    energyKwhDelivered: round(input.energyKwh, 3),
    energyKwhFromGrid: round(fromGrid, 3),
    energyCostPaise: energyCost,
    sessionFeePaise: sessionFee,
    idleCostPaise: idle,
    totalCostPaise: total,
    totalCostInr: round(total / 100, 2),
    data_label: 'estimated',
  };
}

/**
 * Energy needed for a trip and estimated destination SOC.
 * Uses straight efficiency × distance; labeled estimated.
 */
export function estimateTripEnergy(input: TripEnergyInput): TripEnergyResult {
  const reserve = input.safetyReservePercent ?? 10;
  const ac = input.cabinAcWhPerKm ?? 0;
  const loadPenalty = input.loadKg && input.loadKg > 0 ? (input.loadKg / 100) * 2 : 0; // ~2 Wh/km per 100kg
  const eff = input.efficiencyWhPerKm + ac + loadPenalty;
  const energy = (eff / 1000) * input.distanceKm;
  const startKwh = energyAtSoc(input.usableKwh, input.socStartPercent);
  const endKwh = startKwh - energy;
  const destSoc = clamp((endKwh / input.usableKwh) * 100, -50, 100);
  const minAcceptable = input.targetSocArrivalPercent + reserve;
  const needsCharge = destSoc < minAcceptable;
  const chargeNeeded = needsCharge
    ? energyAtSoc(input.usableKwh, minAcceptable) - Math.max(0, endKwh)
    : 0;

  let confidence = 68;
  if (input.distanceKm > 400) confidence -= 10;
  if (ac > 0) confidence -= 3;

  return {
    energyKwhEst: round(energy, 3),
    destSocPercent: round(destSoc, 1),
    needsCharge,
    chargeKwhNeeded: round(Math.max(0, chargeNeeded), 3),
    confidence: clamp(confidence, 0, 100),
    safetyReservePercent: reserve,
    disclaimer: 'Estimates only — arrival SOC not guaranteed. Roads, traffic, weather, and driving style vary.',
    data_label: 'estimated',
  };
}

/** Simple charge-time model with optional high-SOC taper. */
export function estimateChargeTime(input: ChargeTimeInput): ChargeTimeResult {
  const energy = energyAtSoc(input.usableKwh, input.socTarget) - energyAtSoc(input.usableKwh, input.socStart);
  const kwh = Math.max(0, energy);
  const taperStart = input.taperStartSoc ?? 80;
  const taperFactor = input.taperFactor ?? 0.55;

  let durationMin = 0;
  if (input.chargerKw <= 0 || kwh <= 0) {
    return { energyKwh: 0, durationMin: 0, avgPowerKw: 0, data_label: 'estimated' };
  }

  if (input.socTarget <= taperStart || input.socStart >= taperStart) {
    const power =
      input.socStart >= taperStart ? input.chargerKw * taperFactor : input.chargerKw;
    durationMin = (kwh / power) * 60;
  } else {
    const preKwh = energyAtSoc(input.usableKwh, taperStart) - energyAtSoc(input.usableKwh, input.socStart);
    const postKwh = energyAtSoc(input.usableKwh, input.socTarget) - energyAtSoc(input.usableKwh, taperStart);
    durationMin = (Math.max(0, preKwh) / input.chargerKw) * 60 +
      (Math.max(0, postKwh) / (input.chargerKw * taperFactor)) * 60;
  }

  const avgPower = durationMin > 0 ? (kwh / durationMin) * 60 : 0;
  return {
    energyKwh: round(kwh, 3),
    durationMin: round(durationMin, 1),
    avgPowerKw: round(avgPower, 2),
    data_label: 'estimated',
  };
}

/** Haversine distance in km (WGS84). */
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function toRad(d: number): number {
  return (d * Math.PI) / 180;
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

export function paiseToInr(paise: number): number {
  return round(paise / 100, 2);
}

export function inrToPaise(inr: number): number {
  return Math.round(inr * 100);
}
