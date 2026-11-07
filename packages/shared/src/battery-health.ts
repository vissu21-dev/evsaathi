/**
 * Advanced battery health trends with uncertainty gates (P4-M04).
 * Never invent SOH / "100% health" from sparse sessions.
 */

export interface BatteryHealthSample {
  observed_at: string;
  /** Usable kWh inferred from charge energy / SOC delta, when available. */
  inferred_usable_kwh?: number | null;
  /** Efficiency Wh/km from trip/session history. */
  efficiency_wh_per_km?: number | null;
  /** Odometer km if known. */
  odometer_km?: number | null;
  source: string;
}

export interface BatteryHealthInput {
  /** Catalog / configured usable kWh (baseline, not measured SOH). */
  catalogUsableKwh: number;
  samples: BatteryHealthSample[];
  /** Distinct completed charge sessions with SOC start/end. */
  sessionCount: number;
  /** Span of history in days (newest − oldest sample). */
  historySpanDays?: number | null;
}

export interface BatteryHealthResult {
  status: 'insufficient_history' | 'trend_only' | 'bounded_estimate';
  /** Point estimate of remaining usable capacity vs catalog — null when gated. */
  soh_percent: number | null;
  /** Uncertainty band around soh_percent (absolute percentage points). */
  uncertainty_pp: number | null;
  soh_low_percent: number | null;
  soh_high_percent: number | null;
  sample_count: number;
  session_count: number;
  history_span_days: number | null;
  gates: {
    min_sessions: number;
    min_samples: number;
    min_span_days: number;
    sessions_met: boolean;
    samples_met: boolean;
    span_met: boolean;
  };
  trend: {
    direction: 'unknown' | 'stable' | 'improving' | 'declining';
    efficiency_slope_wh_per_km_per_30d: number | null;
  };
  display: {
    headline: string;
    detail: string;
    show_numeric_soh: boolean;
  };
  data_label: 'estimated';
  formula_version: 'p4-health-v1';
  provenance_note: string;
}

/** Hard gates — do not show numeric SOH below these. */
export const BATTERY_HEALTH_GATES = {
  minSessions: 8,
  minSamples: 6,
  minSpanDays: 30,
  /** Sessions needed for a qualitative trend (still no SOH %). */
  trendMinSessions: 4,
  trendMinSamples: 3,
} as const;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

function mean(vals: number[]): number | null {
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function stdDev(vals: number[]): number | null {
  if (vals.length < 2) return null;
  const m = mean(vals)!;
  const v = vals.reduce((a, b) => a + (b - m) ** 2, 0) / (vals.length - 1);
  return Math.sqrt(v);
}

function historySpanDays(samples: BatteryHealthSample[]): number | null {
  if (samples.length < 2) return null;
  const times = samples
    .map((s) => new Date(s.observed_at).getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  if (times.length < 2) return null;
  return (times[times.length - 1] - times[0]) / (24 * 60 * 60 * 1000);
}

export function computeBatteryHealth(input: BatteryHealthInput): BatteryHealthResult {
  const gates = {
    min_sessions: BATTERY_HEALTH_GATES.minSessions,
    min_samples: BATTERY_HEALTH_GATES.minSamples,
    min_span_days: BATTERY_HEALTH_GATES.minSpanDays,
    sessions_met: input.sessionCount >= BATTERY_HEALTH_GATES.minSessions,
    samples_met: input.samples.length >= BATTERY_HEALTH_GATES.minSamples,
    span_met: false,
  };

  const span =
    input.historySpanDays != null && Number.isFinite(input.historySpanDays)
      ? input.historySpanDays
      : historySpanDays(input.samples);
  gates.span_met = span != null && span >= BATTERY_HEALTH_GATES.minSpanDays;

  const usableSamples = input.samples
    .map((s) => s.inferred_usable_kwh)
    .filter((v): v is number => v != null && v > 0 && Number.isFinite(v));

  const effSamples = [...input.samples]
    .filter((s) => s.efficiency_wh_per_km != null && s.efficiency_wh_per_km! > 0)
    .sort((a, b) => new Date(a.observed_at).getTime() - new Date(b.observed_at).getTime());

  let efficiencySlope: number | null = null;
  if (effSamples.length >= 2) {
    const first = effSamples[0].efficiency_wh_per_km!;
    const last = effSamples[effSamples.length - 1].efficiency_wh_per_km!;
    const days =
      (new Date(effSamples[effSamples.length - 1].observed_at).getTime() -
        new Date(effSamples[0].observed_at).getTime()) /
      (24 * 60 * 60 * 1000);
    if (days >= 7) {
      efficiencySlope = round(((last - first) / days) * 30, 2);
    }
  }

  let trendDirection: BatteryHealthResult['trend']['direction'] = 'unknown';
  if (efficiencySlope != null) {
    if (Math.abs(efficiencySlope) < 1.5) trendDirection = 'stable';
    else if (efficiencySlope > 0) trendDirection = 'declining'; // higher Wh/km = worse
    else trendDirection = 'improving';
  }

  const trendOk =
    input.sessionCount >= BATTERY_HEALTH_GATES.trendMinSessions &&
    input.samples.length >= BATTERY_HEALTH_GATES.trendMinSamples;

  const allGatesMet = gates.sessions_met && gates.samples_met && gates.span_met && usableSamples.length >= 4;

  const provenance_note =
    'Battery health is evidence-gated. Numeric SOH is withheld until enough sessions, samples, and calendar span exist. Never treat catalog usable kWh as measured health.';

  if (!allGatesMet) {
    if (trendOk) {
      return {
        status: 'trend_only',
        soh_percent: null,
        uncertainty_pp: null,
        soh_low_percent: null,
        soh_high_percent: null,
        sample_count: input.samples.length,
        session_count: input.sessionCount,
        history_span_days: span != null ? round(span, 1) : null,
        gates,
        trend: {
          direction: trendDirection,
          efficiency_slope_wh_per_km_per_30d: efficiencySlope,
        },
        display: {
          headline: 'Trend only — SOH hidden',
          detail:
            'Not enough history for a bounded health estimate. Keep logging sessions; we show efficiency direction without inventing a health %.',
          show_numeric_soh: false,
        },
        data_label: 'estimated',
        formula_version: 'p4-health-v1',
        provenance_note,
      };
    }

    return {
      status: 'insufficient_history',
      soh_percent: null,
      uncertainty_pp: null,
      soh_low_percent: null,
      soh_high_percent: null,
      sample_count: input.samples.length,
      session_count: input.sessionCount,
      history_span_days: span != null ? round(span, 1) : null,
      gates,
      trend: {
        direction: 'unknown',
        efficiency_slope_wh_per_km_per_30d: null,
      },
      display: {
        headline: 'Battery health unavailable',
        detail: `Need ≥${BATTERY_HEALTH_GATES.minSessions} sessions, ≥${BATTERY_HEALTH_GATES.minSamples} capacity/efficiency samples, and ≥${BATTERY_HEALTH_GATES.minSpanDays} days of history. Do not show 100% by default.`,
        show_numeric_soh: false,
      },
      data_label: 'estimated',
      formula_version: 'p4-health-v1',
      provenance_note,
    };
  }

  const meanUsable = mean(usableSamples)!;
  const sd = stdDev(usableSamples) ?? meanUsable * 0.03;
  const soh = clamp(round((meanUsable / input.catalogUsableKwh) * 100, 1), 50, 105);
  // Uncertainty grows when sample noise is high or catalog baseline is uncertain
  const uncertainty = clamp(round((sd / input.catalogUsableKwh) * 100 * 1.96, 1), 2, 15);
  const sohLow = clamp(round(soh - uncertainty, 1), 40, 105);
  const sohHigh = clamp(round(soh + uncertainty, 1), 40, 110);

  return {
    status: 'bounded_estimate',
    soh_percent: soh,
    uncertainty_pp: uncertainty,
    soh_low_percent: sohLow,
    soh_high_percent: sohHigh,
    sample_count: input.samples.length,
    session_count: input.sessionCount,
    history_span_days: span != null ? round(span, 1) : null,
    gates,
    trend: {
      direction: trendDirection,
      efficiency_slope_wh_per_km_per_30d: efficiencySlope,
    },
    display: {
      headline: `Estimated usable capacity ${soh}% ±${uncertainty} pp`,
      detail:
        'Bounded estimate from inferred usable kWh vs catalog baseline. Band reflects sample noise — not a warranty SOH or OEM BMS reading.',
      show_numeric_soh: true,
    },
    data_label: 'estimated',
    formula_version: 'p4-health-v1',
    provenance_note,
  };
}
