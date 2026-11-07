/**
 * Common telemetry ingest model + data-source mapping (P3-M01 / M04).
 * Never invent LIVE without a real authorized feed.
 */

import type { DataSourceLabel } from './types';

export type TelemetryAdapterKind =
  | 'oem'
  | 'telematics'
  | 'obd'
  | 'manual'
  | 'import'
  | 'operator_session'
  | 'estimator';

export type AdapterMode = 'live' | 'demo' | 'simulated' | 'offline';

export type ChargingStatus =
  | 'idle'
  | 'plugged_ac'
  | 'plugged_dc'
  | 'charging'
  | 'complete'
  | 'error'
  | 'unknown';

export interface TelemetryLocation {
  lat: number;
  lng: number;
  accuracy_m?: number | null;
}

export interface TelemetryEnergy {
  session_kwh?: number | null;
  lifetime_kwh_used?: number | null;
  efficiency_kwh_per_100km?: number | null;
  charge_power_kw?: number | null;
}

export interface TelemetryObservation {
  vehicle_id: string;
  observed_at: string; // ISO
  soc_percent: number;
  range_km?: number | null;
  odometer_km?: number | null;
  charging_status?: ChargingStatus;
  location?: TelemetryLocation | null;
  energy?: TelemetryEnergy | null;
  /** Machine source enum stored on Telemetry.source */
  source: TelemetryAdapterKind | string;
  /** UI provenance label */
  data_label: DataSourceLabel;
  source_metadata: {
    adapter: string;
    mode: AdapterMode;
    confidence: number;
    raw_ref?: string | null;
    note?: string;
  };
}

export interface VehicleTelemetryAdapter {
  readonly id: string;
  readonly kind: TelemetryAdapterKind;
  readonly mode: AdapterMode;
  readonly displayName: string;
  /** Capabilities advertised to UI / admin */
  readonly capabilities: Array<'pull' | 'webhook' | 'import'>;
  pull(vehicleId: string): Promise<TelemetryObservation | null>;
}

/** Map adapter mode + age → honest UI label. Demo/simulated never become LIVE. */
export function labelFromAdapterFreshness(input: {
  mode: AdapterMode;
  observedAt: Date | string | null | undefined;
  now?: Date;
  /** Max age (ms) still considered near-real-time for a live-mode adapter */
  liveMaxAgeMs?: number;
  /** Max age (ms) still considered recently synchronized */
  syncMaxAgeMs?: number;
}): DataSourceLabel {
  const { mode } = input;
  if (mode === 'demo' || mode === 'simulated') {
    // Demo fixtures are never LIVE — treat as recently_synchronized for UX honesty
    return 'recently_synchronized';
  }
  if (mode === 'offline' || !input.observedAt) {
    return 'manually_entered';
  }
  const now = input.now ?? new Date();
  const observed =
    typeof input.observedAt === 'string' ? new Date(input.observedAt) : input.observedAt;
  const ageMs = Math.max(0, now.getTime() - observed.getTime());
  const liveMax = input.liveMaxAgeMs ?? 2 * 60 * 1000;
  const syncMax = input.syncMaxAgeMs ?? 6 * 60 * 60 * 1000;
  if (mode === 'live' && ageMs <= liveMax) return 'live';
  if (ageMs <= syncMax) return 'recently_synchronized';
  return 'recently_synchronized';
}

export function sourceToDataLabel(
  source: string,
  opts?: { mode?: AdapterMode; observedAt?: Date | string | null },
): DataSourceLabel {
  if (source === 'manual') return 'manually_entered';
  if (source === 'import' || source === 'imported') return 'imported';
  if (source === 'estimated' || source === 'estimator') return 'estimated';
  if (opts?.mode) {
    return labelFromAdapterFreshness({
      mode: opts.mode,
      observedAt: opts.observedAt ?? null,
    });
  }
  if (source === 'oem' || source === 'telematics' || source === 'obd' || source === 'operator_session') {
    return 'recently_synchronized';
  }
  return 'manually_entered';
}

export function freshnessAgeLabel(observedAt: Date | string | null | undefined, now = new Date()): string {
  if (!observedAt) return 'No observation';
  const t = typeof observedAt === 'string' ? new Date(observedAt) : observedAt;
  const ageMs = Math.max(0, now.getTime() - t.getTime());
  if (ageMs < 60_000) return 'Just now';
  if (ageMs < 3_600_000) return `${Math.round(ageMs / 60_000)} min ago`;
  if (ageMs < 86_400_000) return `${Math.round(ageMs / 3_600_000)} h ago`;
  return `${Math.round(ageMs / 86_400_000)} d ago`;
}

export interface OperatorAdapterCapability {
  catalog?: boolean;
  availability?: boolean;
  tariffs?: boolean;
  session_sync?: boolean;
  /** Always gated — never exposed to AI */
  remote_commands?: boolean;
}

export interface NormalizedOperatorStation {
  external_id: string;
  name: string;
  operator: string;
  lat: number;
  lng: number;
  address?: string | null;
  connectors: Array<{
    type: string;
    max_kw: number;
    count: number;
    available: number | null;
  }>;
  tariff_inr_per_kwh?: number | null;
  status: 'unknown' | 'available' | 'busy' | 'offline' | 'demo';
  provenance: {
    source: 'demo' | 'partner_ocpi' | 'licensed' | 'open_data';
    mode: AdapterMode;
    fetched_at: string;
    license?: string;
    note?: string;
  };
}

export interface OperatorSessionSnapshot {
  external_session_id: string;
  station_external_id: string;
  status: 'active' | 'completed' | 'interrupted' | 'unknown';
  energy_kwh: number | null;
  power_kw: number | null;
  soc_percent: number | null;
  cost_paise: number | null;
  started_at: string;
  updated_at: string;
  series?: Array<{ t: number; power_kw: number; soc?: number }>;
  provenance: {
    source: 'demo' | 'partner_ocpi' | 'operator_api';
    mode: AdapterMode;
    note?: string;
  };
}

export interface ChargingOperatorAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly mode: AdapterMode;
  readonly capabilities: OperatorAdapterCapability;
  fetchStations(bbox?: { minLat: number; minLng: number; maxLat: number; maxLng: number }): Promise<NormalizedOperatorStation[]>;
  fetchSession?(externalSessionId: string): Promise<OperatorSessionSnapshot | null>;
  /** Demo/simulate only — never real remote start without contract */
  listDemoSessions?(vehicleId: string): Promise<OperatorSessionSnapshot[]>;
}

export interface CircuitBreakerState {
  adapter_id: string;
  state: 'closed' | 'open' | 'half_open';
  failure_count: number;
  success_count: number;
  opened_at?: string | null;
  last_error?: string | null;
  last_checked_at: string;
}

export function nextCircuitState(
  current: CircuitBreakerState,
  outcome: 'success' | 'failure',
  opts?: { openThreshold?: number; halfOpenAfterMs?: number; now?: Date },
): CircuitBreakerState {
  const openThreshold = opts?.openThreshold ?? 3;
  const halfOpenAfterMs = opts?.halfOpenAfterMs ?? 60_000;
  const now = opts?.now ?? new Date();
  const nowIso = now.toISOString();

  if (outcome === 'success') {
    return {
      ...current,
      state: 'closed',
      failure_count: 0,
      success_count: current.success_count + 1,
      opened_at: null,
      last_error: null,
      last_checked_at: nowIso,
    };
  }

  const failures = current.failure_count + 1;
  if (current.state === 'open') {
    const opened = current.opened_at ? new Date(current.opened_at).getTime() : 0;
    if (now.getTime() - opened >= halfOpenAfterMs) {
      return {
        ...current,
        state: 'half_open',
        failure_count: failures,
        last_checked_at: nowIso,
        last_error: current.last_error,
      };
    }
    return { ...current, failure_count: failures, last_checked_at: nowIso };
  }

  if (failures >= openThreshold) {
    return {
      ...current,
      state: 'open',
      failure_count: failures,
      opened_at: nowIso,
      last_checked_at: nowIso,
      last_error: current.last_error ?? 'threshold_exceeded',
    };
  }

  return {
    ...current,
    failure_count: failures,
    last_checked_at: nowIso,
  };
}

export function isCircuitAllowingCalls(state: CircuitBreakerState, now = new Date(), halfOpenAfterMs = 60_000): boolean {
  if (state.state === 'closed' || state.state === 'half_open') return true;
  if (!state.opened_at) return false;
  return now.getTime() - new Date(state.opened_at).getTime() >= halfOpenAfterMs;
}
