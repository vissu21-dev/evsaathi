import { describe, expect, it } from 'vitest';
import {
  RELIABILITY_WEIGHTS,
  applyWeightRedistribution,
  computeConfidence,
  computeReliabilityScore,
  normalizeComponents,
} from './reliability';

describe('reliability weights', () => {
  it('default weights sum to 1', () => {
    const sum = Object.values(RELIABILITY_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it('redistributes operator + review when absent', () => {
    const w = applyWeightRedistribution({ hasOperatorFeed: false, reviewCount: 0 });
    expect(w.operator).toBe(0);
    expect(w.access_review).toBe(0);
    const sum = Object.values(w).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
    expect(w.success).toBeGreaterThan(RELIABILITY_WEIGHTS.success);
  });
});

describe('computeReliabilityScore', () => {
  it('returns insufficient_data when confidence < 25', () => {
    const r = computeReliabilityScore({
      successCount30d: 0,
      attemptCount30d: 0,
      openFailures: [],
      crowdSamples30d: 0,
      hasOperatorFeed: false,
      reviewCount: 0,
      hasRecentVerification7d: false,
    });
    expect(r.confidence).toBeLessThan(25);
    expect(r.display).toBe('insufficient_data');
    expect(r.score).toBeNull();
    expect(r.provenance_note).toMatch(/Crowdsource/);
  });

  it('scores high with many successes and recent verification', () => {
    const r = computeReliabilityScore({
      successCount30d: 12,
      attemptCount30d: 14,
      openFailures: [{ severity: 'low' }],
      crowdSamples30d: 14,
      powerRatio: 0.9,
      availabilityShare: 0.8,
      hasOperatorFeed: false,
      hoursSinceVerification: 12,
      reviewAvg: 4.2,
      reviewCount: 6,
      hasRecentVerification7d: true,
    });
    expect(r.confidence).toBeGreaterThanOrEqual(25);
    expect(r.display).toBe('score');
    expect(r.score).toBeGreaterThan(60);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.formula_version).toBe('p2-v1');
  });

  it('caps score at 75 when crowd_samples_30d < 3', () => {
    const r = computeReliabilityScore({
      successCount30d: 2,
      attemptCount30d: 2,
      openFailures: [],
      crowdSamples30d: 2,
      powerRatio: 1,
      availabilityShare: 1,
      hasOperatorFeed: true,
      operatorHealth: 1,
      hoursSinceVerification: 1,
      hasRecentVerification7d: true,
      reviewCount: 0,
    });
    expect(r.caps.low_sample_cap_applied).toBe(true);
    if (r.score != null) expect(r.score).toBeLessThanOrEqual(75);
  });

  it('penalizes open high-severity failures', () => {
    const good = computeReliabilityScore({
      successCount30d: 10,
      attemptCount30d: 10,
      openFailures: [],
      crowdSamples30d: 10,
      hasRecentVerification7d: true,
      hoursSinceVerification: 24,
      reviewCount: 5,
      reviewAvg: 4,
    });
    const bad = computeReliabilityScore({
      successCount30d: 2,
      attemptCount30d: 10,
      openFailures: [
        { severity: 'high', category: 'charger_dead' },
        { severity: 'high', category: 'charger_dead' },
        { severity: 'medium', category: 'payment_failed' },
      ],
      crowdSamples30d: 10,
      hasRecentVerification7d: true,
      hoursSinceVerification: 24,
      reviewCount: 5,
      reviewAvg: 2,
    });
    expect(good.score_raw).toBeGreaterThan(bad.score_raw);
  });

  it('normalizeComponents uses neutral priors when empty', () => {
    const c = normalizeComponents({
      successCount30d: 0,
      attemptCount30d: 0,
      openFailures: [],
      crowdSamples30d: 0,
    });
    expect(c.success).toBe(0.5);
    expect(c.power_truth).toBe(0.5);
    expect(c.availability).toBe(0.5);
  });

  it('confidence grows with crowd samples', () => {
    const low = computeConfidence({
      crowdSamples30d: 1,
      hasOperatorFeed: false,
      reviewCount: 0,
      hasRecentVerification7d: false,
    });
    const high = computeConfidence({
      crowdSamples30d: 40,
      hasOperatorFeed: true,
      reviewCount: 10,
      hasRecentVerification7d: true,
    });
    expect(high).toBeGreaterThan(low);
  });
});
