/**
 * Advanced trip planner station ranking (Module E).
 * Strategies: Fastest | Lowest cost | Most reliable.
 */

export type TripStrategy = 'fastest' | 'lowest_cost' | 'most_reliable';

export interface StationCandidate {
  id: string;
  name: string;
  /** Detour from ideal corridor mid-point, km. */
  detourKm: number;
  /** Max DC (or best) charger power kW. */
  maxPowerKw: number;
  /** Estimated ₹/kWh (paise). */
  energyRatePaise: number;
  /** Reliability 0–100; null if insufficient data. */
  reliabilityScore: number | null;
  reliabilityConfidence: number;
  isDemo?: boolean;
}

export interface RankedStation extends StationCandidate {
  strategy_score: number;
  rank_reason: string;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * Score a candidate for a strategy (higher = better).
 * Pure function — unit-tested.
 */
export function scoreStationForStrategy(
  station: StationCandidate,
  strategy: TripStrategy,
): { score: number; reason: string } {
  const detourPenalty = clamp(station.detourKm / 40, 0, 1); // 40km detour → full penalty
  const powerScore = clamp(station.maxPowerKw / 140, 0, 1);
  const costScore = clamp(1 - (station.energyRatePaise - 1200) / 2000, 0, 1);
  const rel =
    station.reliabilityScore != null && station.reliabilityConfidence >= 25
      ? station.reliabilityScore / 100
      : 0.45; // neutral-low when unknown

  switch (strategy) {
    case 'fastest': {
      // Prefer high power, low detour; reliability secondary
      const score = 0.55 * powerScore + 0.3 * (1 - detourPenalty) + 0.15 * rel;
      return {
        score,
        reason: `Fastest: ${station.maxPowerKw} kW · detour ${station.detourKm.toFixed(1)} km`,
      };
    }
    case 'lowest_cost': {
      const score = 0.55 * costScore + 0.25 * (1 - detourPenalty) + 0.2 * rel;
      return {
        score,
        reason: `Lowest cost: ₹${(station.energyRatePaise / 100).toFixed(0)}/kWh · detour ${station.detourKm.toFixed(1)} km`,
      };
    }
    case 'most_reliable': {
      const score = 0.6 * rel + 0.25 * (1 - detourPenalty) + 0.15 * powerScore;
      return {
        score,
        reason:
          station.reliabilityScore != null
            ? `Most reliable: score ${station.reliabilityScore} (conf ${station.reliabilityConfidence})`
            : 'Most reliable: insufficient reliability data — neutral prior',
      };
    }
    default:
      return { score: 0, reason: 'unknown strategy' };
  }
}

/** Rank candidates for a strategy (best first). */
export function rankStationsByStrategy(
  candidates: StationCandidate[],
  strategy: TripStrategy,
): RankedStation[] {
  return candidates
    .map((c) => {
      const { score, reason } = scoreStationForStrategy(c, strategy);
      return { ...c, strategy_score: Math.round(score * 1000) / 1000, rank_reason: reason };
    })
    .sort((a, b) => b.strategy_score - a.strategy_score);
}

/** Pick top N stops for a trip under a strategy. */
export function selectStopsForStrategy(
  candidates: StationCandidate[],
  strategy: TripStrategy,
  limit = 2,
): RankedStation[] {
  return rankStationsByStrategy(candidates, strategy).slice(0, limit);
}

/**
 * Compare strategies and return which station each would pick first —
 * useful for trip result alternatives.
 */
export function strategyComparison(
  candidates: StationCandidate[],
): Record<TripStrategy, RankedStation | null> {
  const strategies: TripStrategy[] = ['fastest', 'lowest_cost', 'most_reliable'];
  const out = {} as Record<TripStrategy, RankedStation | null>;
  for (const s of strategies) {
    out[s] = selectStopsForStrategy(candidates, s, 1)[0] ?? null;
  }
  return out;
}
