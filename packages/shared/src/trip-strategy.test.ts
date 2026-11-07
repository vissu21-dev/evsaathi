import { describe, expect, it } from 'vitest';
import {
  rankStationsByStrategy,
  scoreStationForStrategy,
  selectStopsForStrategy,
  strategyComparison,
  type StationCandidate,
} from './trip-strategy';

const candidates: StationCandidate[] = [
  {
    id: 'fast-expensive',
    name: 'Highway 140 kW',
    detourKm: 5,
    maxPowerKw: 140,
    energyRatePaise: 2200,
    reliabilityScore: 70,
    reliabilityConfidence: 55,
  },
  {
    id: 'cheap-slow',
    name: 'City AC 22 kW',
    detourKm: 8,
    maxPowerKw: 22,
    energyRatePaise: 1400,
    reliabilityScore: 65,
    reliabilityConfidence: 50,
  },
  {
    id: 'reliable-mid',
    name: 'Trusted 60 kW',
    detourKm: 12,
    maxPowerKw: 60,
    energyRatePaise: 1800,
    reliabilityScore: 92,
    reliabilityConfidence: 70,
  },
];

describe('trip strategy selection', () => {
  it('fastest prefers highest power / low detour', () => {
    const ranked = rankStationsByStrategy(candidates, 'fastest');
    expect(ranked[0].id).toBe('fast-expensive');
    expect(ranked[0].strategy_score).toBeGreaterThan(ranked[1].strategy_score);
  });

  it('lowest_cost prefers cheaper energy rate', () => {
    const ranked = rankStationsByStrategy(candidates, 'lowest_cost');
    expect(ranked[0].id).toBe('cheap-slow');
  });

  it('most_reliable prefers highest reliability score', () => {
    const ranked = rankStationsByStrategy(candidates, 'most_reliable');
    expect(ranked[0].id).toBe('reliable-mid');
  });

  it('selectStopsForStrategy respects limit', () => {
    const stops = selectStopsForStrategy(candidates, 'fastest', 2);
    expect(stops).toHaveLength(2);
    expect(stops[0].id).toBe('fast-expensive');
  });

  it('strategyComparison returns distinct picks when signals differ', () => {
    const cmp = strategyComparison(candidates);
    expect(cmp.fastest?.id).toBe('fast-expensive');
    expect(cmp.lowest_cost?.id).toBe('cheap-slow');
    expect(cmp.most_reliable?.id).toBe('reliable-mid');
  });

  it('unknown reliability uses neutral prior without crashing', () => {
    const s = scoreStationForStrategy(
      {
        id: 'x',
        name: 'Unknown',
        detourKm: 3,
        maxPowerKw: 50,
        energyRatePaise: 1800,
        reliabilityScore: null,
        reliabilityConfidence: 10,
      },
      'most_reliable',
    );
    expect(s.score).toBeGreaterThan(0);
    expect(s.reason).toMatch(/insufficient/i);
  });
});
