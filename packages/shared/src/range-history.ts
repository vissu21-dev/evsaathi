/**
 * History-weighted efficiency / range prediction (P2-M07).
 * Blends catalog Wh/km with observed consumption; never invents OEM live data.
 */

import { estimateRange } from './math';
import type { RangeEstimateResult } from './types';

export interface EfficiencySample {
  /** Observed Wh/km for a drive segment. */
  whPerKm: number;
  /** Segment distance km (weight). */
  distanceKm: number;
  /** Age in days (recency decay). */
  ageDays: number;
}

export interface HistoryWeightedEfficiencyInput {
  catalogWhPerKm: number;
  samples: EfficiencySample[];
  /** Weight on history when sample mass is strong (default 0.7). */
  maxHistoryWeight?: number;
  /** Distance-km needed for full history trust (default 200). */
  fullTrustDistanceKm?: number;
}

export interface HistoryWeightedEfficiencyResult {
  efficiencyWhPerKm: number;
  catalogWhPerKm: number;
  historyWhPerKm: number | null;
  historyWeight: number;
  sampleDistanceKm: number;
  sampleCount: number;
  confidence: number;
  assumptions: string[];
  data_label: 'estimated';
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/**
 * Recency-decayed, distance-weighted mean of observed Wh/km.
 * age decay: weight *= exp(-ageDays / 45)
 */
export function historyWeightedEfficiency(
  input: HistoryWeightedEfficiencyInput,
): HistoryWeightedEfficiencyResult {
  const maxHist = input.maxHistoryWeight ?? 0.7;
  const fullTrust = input.fullTrustDistanceKm ?? 200;

  let weightedSum = 0;
  let weightTotal = 0;
  let distanceTotal = 0;

  for (const s of input.samples) {
    if (s.whPerKm <= 0 || s.distanceKm <= 0) continue;
    const decay = Math.exp(-Math.max(0, s.ageDays) / 45);
    const w = s.distanceKm * decay;
    weightedSum += s.whPerKm * w;
    weightTotal += w;
    distanceTotal += s.distanceKm;
  }

  const historyWh =
    weightTotal > 0 ? weightedSum / weightTotal : null;

  const trust = clamp(distanceTotal / fullTrust, 0, 1);
  const historyWeight = historyWh != null ? maxHist * trust : 0;
  const blended =
    historyWh != null
      ? historyWeight * historyWh + (1 - historyWeight) * input.catalogWhPerKm
      : input.catalogWhPerKm;

  let confidence = 55;
  confidence += Math.round(trust * 30);
  if (input.samples.length >= 5) confidence += 5;
  if (historyWh == null) confidence = 50;

  const assumptions = [
    `Catalog highway/city efficiency ${input.catalogWhPerKm} Wh/km`,
    historyWh != null
      ? `History-weighted observed ${round(historyWh, 1)} Wh/km from ${input.samples.length} segments (${round(distanceTotal, 1)} km, recency decay τ=45d)`
      : 'No usable history segments — catalog only',
    `Blend weight on history: ${round(historyWeight, 2)} (cap ${maxHist})`,
    'Not OEM live telemetry — MANUAL/IMPORT samples + EST. blend',
  ];

  return {
    efficiencyWhPerKm: round(blended, 1),
    catalogWhPerKm: input.catalogWhPerKm,
    historyWhPerKm: historyWh != null ? round(historyWh, 1) : null,
    historyWeight: round(historyWeight, 3),
    sampleDistanceKm: round(distanceTotal, 1),
    sampleCount: input.samples.length,
    confidence: clamp(confidence, 0, 100),
    assumptions,
    data_label: 'estimated',
  };
}

/** Range estimate using history-weighted efficiency. */
export function estimateRangeWithHistory(opts: {
  socPercent: number;
  usableKwh: number;
  catalogWhPerKm: number;
  samples: EfficiencySample[];
  safetyReservePercent?: number;
}): RangeEstimateResult & {
  efficiency_model: HistoryWeightedEfficiencyResult;
} {
  const model = historyWeightedEfficiency({
    catalogWhPerKm: opts.catalogWhPerKm,
    samples: opts.samples,
  });
  const base = estimateRange({
    socPercent: opts.socPercent,
    usableKwh: opts.usableKwh,
    efficiencyWhPerKm: model.efficiencyWhPerKm,
    safetyReservePercent: opts.safetyReservePercent,
  });
  return {
    ...base,
    confidence: Math.min(base.confidence, model.confidence),
    assumptions: [...model.assumptions, ...base.assumptions],
    efficiency_model: model,
  };
}
