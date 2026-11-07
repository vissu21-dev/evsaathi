/**
 * Advanced analytics over richer telemetry when present (P3-M07).
 * Degrades gracefully to basic aggregates when only manual samples exist.
 */

export interface TelemetryPoint {
  observed_at: string;
  soc_percent: number;
  odometer_km?: number | null;
  charge_power_kw?: number | null;
  session_kwh?: number | null;
  source: string;
  data_label?: string;
}

export interface SessionTelemetryPoint {
  energy_kwh?: number | null;
  avg_power_kw?: number | null;
  max_power_kw?: number | null;
  soc_start?: number | null;
  soc_end?: number | null;
  source: string;
  started_at: string;
}

export interface AdvancedAnalyticsResult {
  richness: 'manual_sparse' | 'manual_dense' | 'adapter_enriched';
  sample_count: number;
  adapter_sample_count: number;
  soc_volatility: number | null;
  mean_charge_power_kw: number | null;
  peak_charge_power_kw: number | null;
  energy_per_session_kwh: number | null;
  estimated_cycles: number | null;
  efficiency_trend_kwh_per_100km: number | null;
  notes: string[];
  data_label: 'estimated' | 'manually_entered' | 'recently_synchronized';
}

function stdDev(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function computeAdvancedAnalytics(input: {
  telemetry: TelemetryPoint[];
  sessions: SessionTelemetryPoint[];
  usableKwh: number;
}): AdvancedAnalyticsResult {
  const { telemetry, sessions, usableKwh } = input;
  const adapterSamples = telemetry.filter((t) =>
    ['oem', 'telematics', 'obd', 'operator_session'].includes(t.source),
  );
  const powerSamples = [
    ...telemetry.map((t) => t.charge_power_kw).filter((p): p is number => p != null && p > 0),
    ...sessions.map((s) => s.avg_power_kw).filter((p): p is number => p != null && p > 0),
  ];
  const peakSamples = [
    ...telemetry.map((t) => t.charge_power_kw).filter((p): p is number => p != null && p > 0),
    ...sessions.map((s) => s.max_power_kw).filter((p): p is number => p != null && p > 0),
  ];

  const richness: AdvancedAnalyticsResult['richness'] =
    adapterSamples.length >= 3
      ? 'adapter_enriched'
      : telemetry.length >= 10 || sessions.some((s) => (s.max_power_kw ?? 0) > 0)
        ? 'manual_dense'
        : 'manual_sparse';

  const notes: string[] = [];
  if (richness === 'manual_sparse') {
    notes.push('Sparse manual data — advanced metrics limited. Connect a consented adapter or log denser sessions.');
  } else if (richness === 'manual_dense') {
    notes.push('Dense manual/import samples — power curves and trends are estimated from owner logs.');
  } else {
    notes.push('Adapter-enriched telemetry present — still demo/synced unless a live partnership feed is authorized.');
  }

  // Rough cycle estimate: sum of positive SOC rises / 100
  let socRise = 0;
  const sorted = [...telemetry].sort(
    (a, b) => new Date(a.observed_at).getTime() - new Date(b.observed_at).getTime(),
  );
  for (let i = 1; i < sorted.length; i++) {
    const d = sorted[i].soc_percent - sorted[i - 1].soc_percent;
    if (d > 0) socRise += d;
  }
  const estimatedCycles =
    sorted.length >= 2 ? Math.round((socRise / 100) * 100) / 100 : null;

  // Efficiency from odometer + SOC deltas
  let efficiency: number | null = null;
  const withOdo = sorted.filter((t) => t.odometer_km != null);
  if (withOdo.length >= 2 && usableKwh > 0) {
    const newest = withOdo[withOdo.length - 1];
    const oldest = withOdo[0];
    const dist = (newest.odometer_km ?? 0) - (oldest.odometer_km ?? 0);
    const socDelta = (oldest.soc_percent - newest.soc_percent) / 100;
    if (dist > 5 && socDelta > 0) {
      efficiency = Math.round(((socDelta * usableKwh) / dist) * 100 * 10) / 10;
    }
  }

  const energyVals = sessions
    .map((s) => s.energy_kwh)
    .filter((e): e is number => e != null && e > 0);
  const meanEnergy =
    energyVals.length > 0
      ? Math.round((energyVals.reduce((a, b) => a + b, 0) / energyVals.length) * 100) / 100
      : null;

  const data_label: AdvancedAnalyticsResult['data_label'] =
    adapterSamples.length > 0
      ? 'recently_synchronized'
      : telemetry.length > 0
        ? 'manually_entered'
        : 'estimated';

  return {
    richness,
    sample_count: telemetry.length,
    adapter_sample_count: adapterSamples.length,
    soc_volatility: stdDev(sorted.map((t) => t.soc_percent)),
    mean_charge_power_kw:
      powerSamples.length > 0
        ? Math.round((powerSamples.reduce((a, b) => a + b, 0) / powerSamples.length) * 10) / 10
        : null,
    peak_charge_power_kw: peakSamples.length ? Math.max(...peakSamples) : null,
    energy_per_session_kwh: meanEnergy,
    estimated_cycles: estimatedCycles,
    efficiency_trend_kwh_per_100km: efficiency,
    notes,
    data_label,
  };
}
