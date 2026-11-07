import { describe, expect, it } from 'vitest';
import {
  computeReliabilityScore,
  rankStationsByStrategy,
  selectStopsForStrategy,
  historyWeightedEfficiency,
} from '@evsaathi/shared';

/** Phase 2 API-facing math contracts used by reliability + trip routes */

describe('Phase 2 reliability contract', () => {
  it('documents crowdsource formula outputs for API shape', () => {
    const r = computeReliabilityScore({
      successCount30d: 8,
      attemptCount30d: 10,
      openFailures: [{ severity: 'medium' }],
      crowdSamples30d: 12,
      hoursSinceVerification: 20,
      hasRecentVerification7d: true,
      reviewCount: 5,
      reviewAvg: 4,
      hasOperatorFeed: false,
    });
    expect(r.formula_version).toBe('p2-v1');
    expect(r.provenance_note).toMatch(/Crowdsource/);
    expect(r.weights_applied.operator).toBe(0);
    expect(Object.keys(r.components)).toEqual(
      expect.arrayContaining([
        'success',
        'failure',
        'power_truth',
        'availability',
        'operator',
        'freshness',
        'access_review',
      ]),
    );
  });
});

describe('Phase 2 trip strategy contract', () => {
  it('selects different stops per strategy', () => {
    const candidates = [
      {
        id: 'a',
        name: 'Fast',
        detourKm: 4,
        maxPowerKw: 140,
        energyRatePaise: 2200,
        reliabilityScore: 70,
        reliabilityConfidence: 50,
      },
      {
        id: 'b',
        name: 'Cheap',
        detourKm: 6,
        maxPowerKw: 30,
        energyRatePaise: 1300,
        reliabilityScore: 60,
        reliabilityConfidence: 50,
      },
      {
        id: 'c',
        name: 'Reliable',
        detourKm: 10,
        maxPowerKw: 60,
        energyRatePaise: 1800,
        reliabilityScore: 95,
        reliabilityConfidence: 80,
      },
    ];
    expect(selectStopsForStrategy(candidates, 'fastest', 1)[0].id).toBe('a');
    expect(selectStopsForStrategy(candidates, 'lowest_cost', 1)[0].id).toBe('b');
    expect(selectStopsForStrategy(candidates, 'most_reliable', 1)[0].id).toBe('c');
    expect(rankStationsByStrategy(candidates, 'fastest')[0].strategy_score).toBeGreaterThan(0);
  });
});

describe('Phase 2 history-weighted range contract', () => {
  it('blends catalog with history for advanced range endpoint', () => {
    const m = historyWeightedEfficiency({
      catalogWhPerKm: 185,
      samples: [{ whPerKm: 160, distanceKm: 250, ageDays: 2 }],
    });
    expect(m.data_label).toBe('estimated');
    expect(m.efficiencyWhPerKm).toBeLessThan(185);
    expect(m.historyWeight).toBeGreaterThan(0);
  });
});
