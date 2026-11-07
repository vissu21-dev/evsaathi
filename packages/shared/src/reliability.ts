/**
 * Station reliability score 0–100 (Module D).
 *
 * Crowdsource ≠ operator telemetry — components stay separate; operator feed
 * cannot erase crowd failures. Weights match docs/database-schema.md §6.
 */

export const RELIABILITY_WEIGHTS = {
  success: 0.25,
  failure: 0.2,
  power_truth: 0.1,
  availability: 0.15,
  operator: 0.1,
  freshness: 0.1,
  access_review: 0.1,
} as const;

export type ReliabilityComponentKey = keyof typeof RELIABILITY_WEIGHTS;

export const FAILURE_SEVERITY_WEIGHT: Record<string, number> = {
  low: 0.5,
  medium: 1,
  high: 1.75,
};

/** Report categories that count as positive / working signals. */
export const SUCCESS_CATEGORIES = new Set([
  'working',
  'session_ok',
  'charger_working',
]);

/** Report categories that count as failure / negative signals. */
export const FAILURE_CATEGORIES = new Set([
  'charger_dead',
  'started_failed',
  'payment_failed',
  'power_low',
  'connector_damaged',
  'inaccessible',
  'safety_cleanliness',
  'not_working',
  'other',
]);

export interface ReliabilityInputs {
  /** Positive working reports / verified successes in window. */
  successCount30d: number;
  /** Attempts = successes + failure-ish reports (or explicit attempts). */
  attemptCount30d: number;
  /** Open + confirmed failure reports with severity. */
  openFailures: Array<{ severity: string; category?: string }>;
  /** Crowd samples used for success/failure/availability (reports + observations). */
  crowdSamples30d: number;
  /** Actual avg power / advertised kW ratio (0–1.5 typical). Null → neutral. */
  powerRatio?: number | null;
  /** Available vs faulted observation share 0–1. Null → neutral. */
  availabilityShare?: number | null;
  /** Operator feed present and healthy. */
  hasOperatorFeed?: boolean;
  /** Operator health 0–1 when feed exists. */
  operatorHealth?: number | null;
  /** Hours since last verification (operator sync or trusted crowd). */
  hoursSinceVerification?: number | null;
  /** Access/cleanliness review average 1–5. Null → Bayesian prior. */
  reviewAvg?: number | null;
  reviewCount?: number;
  /** Whether a verification occurred in last 7 days. */
  hasRecentVerification7d?: boolean;
  /** Queue-only reports are soft negatives (not full failures). */
  queueReports30d?: number;
}

export interface ReliabilityResult {
  score: number | null;
  score_raw: number;
  confidence: number;
  display: 'score' | 'insufficient_data';
  last_verified_at?: string | null;
  components: Record<ReliabilityComponentKey, number>;
  weights_applied: Record<ReliabilityComponentKey, number>;
  sample_sizes: {
    crowd_30d: number;
    successes_30d: number;
    attempts_30d: number;
    open_failures: number;
    reviews: number;
  };
  caps: {
    low_sample_cap_applied: boolean;
    score_capped_at?: number;
  };
  provenance_note: string;
  formula_version: 'p2-v1';
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** Map component signals to 0–1. */
export function normalizeComponents(input: ReliabilityInputs): Record<ReliabilityComponentKey, number> {
  const attempts = Math.max(input.attemptCount30d, input.successCount30d);
  const cSuccess =
    attempts <= 0 ? 0.5 : clamp(input.successCount30d / attempts, 0, 1);

  const failurePenalty = input.openFailures.reduce((sum, f) => {
    const sev = FAILURE_SEVERITY_WEIGHT[f.severity] ?? 1;
    return sum + sev;
  }, 0);
  // Soft queue penalty
  const queuePenalty = (input.queueReports30d ?? 0) * 0.25;
  const density = (failurePenalty + queuePenalty) / Math.max(1, input.crowdSamples30d || attempts || 1);
  const cFailure = clamp(1 - density / 2, 0, 1);

  const cPower =
    input.powerRatio == null || Number.isNaN(input.powerRatio)
      ? 0.5
      : clamp(input.powerRatio, 0, 1.2) / 1.2;

  const cAvail =
    input.availabilityShare == null || Number.isNaN(input.availabilityShare)
      ? 0.5
      : clamp(input.availabilityShare, 0, 1);

  const cOperator = input.hasOperatorFeed
    ? clamp(input.operatorHealth ?? 0.7, 0, 1)
    : 0.5; // unused when redistributed

  let cFreshness = 0.5;
  if (input.hoursSinceVerification != null) {
    const h = input.hoursSinceVerification;
    if (h <= 24) cFreshness = 1;
    else if (h <= 72) cFreshness = 0.85;
    else if (h <= 168) cFreshness = 0.65;
    else if (h <= 720) cFreshness = 0.4;
    else cFreshness = 0.2;
  }

  const reviews = input.reviewCount ?? 0;
  let cAccess = 0.6; // Bayesian prior until n≥5
  if (reviews >= 5 && input.reviewAvg != null) {
    cAccess = clamp((input.reviewAvg - 1) / 4, 0, 1);
  } else if (reviews > 0 && input.reviewAvg != null) {
    const observed = clamp((input.reviewAvg - 1) / 4, 0, 1);
    const w = reviews / 5;
    cAccess = 0.6 * (1 - w) + observed * w;
  }

  return {
    success: round(cSuccess, 4),
    failure: round(cFailure, 4),
    power_truth: round(cPower, 4),
    availability: round(cAvail, 4),
    operator: round(cOperator, 4),
    freshness: round(cFreshness, 4),
    access_review: round(cAccess, 4),
  };
}

/** Redistribute missing operator / review weights onto success, failure, availability. */
export function applyWeightRedistribution(opts: {
  hasOperatorFeed: boolean;
  reviewCount: number;
}): Record<ReliabilityComponentKey, number> {
  const w = { ...RELIABILITY_WEIGHTS } as Record<ReliabilityComponentKey, number>;
  const redistributeTargets: ReliabilityComponentKey[] = ['success', 'failure', 'availability'];

  const spare: ReliabilityComponentKey[] = [];
  if (!opts.hasOperatorFeed) spare.push('operator');
  if (opts.reviewCount <= 0) spare.push('access_review');

  for (const key of spare) {
    const amount = w[key];
    w[key] = 0;
    const share = amount / redistributeTargets.length;
    for (const t of redistributeTargets) w[t] += share;
  }

  // Normalize to sum 1 (floating safety)
  const sum = Object.values(w).reduce((a, b) => a + b, 0);
  for (const k of Object.keys(w) as ReliabilityComponentKey[]) {
    w[k] = round(w[k] / sum, 6);
  }
  return w;
}

export function computeConfidence(input: {
  crowdSamples30d: number;
  hasOperatorFeed: boolean;
  reviewCount: number;
  hasRecentVerification7d: boolean;
}): number {
  const conf =
    20 * Math.log10(1 + Math.max(0, input.crowdSamples30d)) +
    (input.hasOperatorFeed ? 10 : 0) +
    5 * Math.log10(1 + Math.max(0, input.reviewCount)) +
    (input.hasRecentVerification7d ? 5 : 0);
  return clamp(Math.round(conf), 0, 100);
}

/**
 * Compute reliability score with documented weights, confidence gate, and low-sample cap.
 */
export function computeReliabilityScore(input: ReliabilityInputs): ReliabilityResult {
  const components = normalizeComponents(input);
  const weights = applyWeightRedistribution({
    hasOperatorFeed: !!input.hasOperatorFeed,
    reviewCount: input.reviewCount ?? 0,
  });

  let scoreRaw = 0;
  for (const k of Object.keys(weights) as ReliabilityComponentKey[]) {
    scoreRaw += weights[k] * components[k];
  }
  scoreRaw = round(100 * scoreRaw, 1);

  const confidence = computeConfidence({
    crowdSamples30d: input.crowdSamples30d,
    hasOperatorFeed: !!input.hasOperatorFeed,
    reviewCount: input.reviewCount ?? 0,
    hasRecentVerification7d: !!input.hasRecentVerification7d,
  });

  let score = scoreRaw;
  let lowSampleCap = false;
  if (input.crowdSamples30d < 3) {
    score = Math.min(score, 75);
    lowSampleCap = true;
  }

  const display: ReliabilityResult['display'] =
    confidence >= 25 ? 'score' : 'insufficient_data';

  return {
    score: display === 'score' ? Math.round(score) : null,
    score_raw: scoreRaw,
    confidence,
    display,
    components,
    weights_applied: weights,
    sample_sizes: {
      crowd_30d: input.crowdSamples30d,
      successes_30d: input.successCount30d,
      attempts_30d: input.attemptCount30d,
      open_failures: input.openFailures.length,
      reviews: input.reviewCount ?? 0,
    },
    caps: {
      low_sample_cap_applied: lowSampleCap,
      score_capped_at: lowSampleCap ? 75 : undefined,
    },
    provenance_note:
      'Crowdsource reliability — not operator live telemetry. Score blends owner reports, verification age, and optional operator feed (capped).',
    formula_version: 'p2-v1',
  };
}
