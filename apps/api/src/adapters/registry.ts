import {
  isCircuitAllowingCalls,
  nextCircuitState,
  type CircuitBreakerState,
  type ChargingOperatorAdapter,
  type VehicleTelemetryAdapter,
} from '@evsaathi/shared';
import { prisma } from '../prisma';
import { DEMO_OEM_ADAPTER_ID, demoOemAdapter } from './demo-oem';
import { DEMO_OPERATOR_ADAPTER_ID, demoOperatorAdapter } from './demo-operator';

/** Optional failure injection for tests / admin drills */
const injectedFailures = new Set<string>();

export function injectAdapterFailure(adapterId: string, fail: boolean) {
  if (fail) injectedFailures.add(adapterId);
  else injectedFailures.delete(adapterId);
}

export function listVehicleAdapters(): VehicleTelemetryAdapter[] {
  return [demoOemAdapter];
}

export function listOperatorAdapters(): ChargingOperatorAdapter[] {
  return [demoOperatorAdapter];
}

export function getVehicleAdapter(id: string): VehicleTelemetryAdapter | null {
  return listVehicleAdapters().find((a) => a.id === id) ?? null;
}

export function getOperatorAdapter(id: string): ChargingOperatorAdapter | null {
  return listOperatorAdapters().find((a) => a.id === id) ?? null;
}

export function catalogAdapters() {
  return {
    vehicle: listVehicleAdapters().map((a) => ({
      id: a.id,
      kind: a.kind,
      mode: a.mode,
      display_name: a.displayName,
      capabilities: a.capabilities,
      live_claim: false,
      note:
        a.mode === 'demo' || a.mode === 'simulated'
          ? 'Demo/simulated — never labeled LIVE'
          : 'Partner feed required for LIVE',
    })),
    operator: listOperatorAdapters().map((a) => ({
      id: a.id,
      mode: a.mode,
      display_name: a.displayName,
      capabilities: a.capabilities,
      live_claim: false,
      note:
        a.mode === 'demo' || a.mode === 'simulated'
          ? 'Demo directory/session stub — availability not LIVE'
          : 'Partner OCPI required for LIVE',
    })),
    defaults: {
      oem: DEMO_OEM_ADAPTER_ID,
      operator: DEMO_OPERATOR_ADAPTER_ID,
    },
  };
}

async function loadBreaker(adapterId: string, kind: string, displayName: string, mode: string): Promise<CircuitBreakerState> {
  const row = await prisma.adapterHealth.findUnique({ where: { adapterId } });
  if (!row) {
    await prisma.adapterHealth.create({
      data: {
        adapterId,
        kind,
        displayName,
        mode,
        status: 'healthy',
        circuitState: 'closed',
      },
    });
    return {
      adapter_id: adapterId,
      state: 'closed',
      failure_count: 0,
      success_count: 0,
      last_checked_at: new Date().toISOString(),
    };
  }
  return {
    adapter_id: row.adapterId,
    state: row.circuitState as CircuitBreakerState['state'],
    failure_count: row.failureCount,
    success_count: row.successCount,
    opened_at: row.openedAt?.toISOString() ?? null,
    last_error: row.lastError,
    last_checked_at: row.updatedAt.toISOString(),
  };
}

async function persistBreaker(state: CircuitBreakerState, meta: { kind: string; displayName: string; mode: string }) {
  const status =
    state.state === 'open' ? 'degraded' : state.failure_count > 0 ? 'degraded' : 'healthy';
  await prisma.adapterHealth.upsert({
    where: { adapterId: state.adapter_id },
    create: {
      adapterId: state.adapter_id,
      kind: meta.kind,
      displayName: meta.displayName,
      mode: meta.mode,
      status,
      circuitState: state.state,
      failureCount: state.failure_count,
      successCount: state.success_count,
      lastError: state.last_error,
      openedAt: state.opened_at ? new Date(state.opened_at) : null,
      lastSuccessAt: state.state === 'closed' && state.success_count > 0 ? new Date() : null,
      lastFailureAt: state.failure_count > 0 ? new Date() : null,
    },
    update: {
      status,
      circuitState: state.state,
      failureCount: state.failure_count,
      successCount: state.success_count,
      lastError: state.last_error,
      openedAt: state.opened_at ? new Date(state.opened_at) : null,
      lastSuccessAt: state.state === 'closed' ? new Date() : undefined,
      lastFailureAt: state.failure_count > 0 ? new Date() : undefined,
    },
  });
}

export type AdapterCallResult<T> =
  | { ok: true; data: T; degraded: false }
  | { ok: false; degraded: true; reason: string; fallback: 'manual' };

export async function callVehicleAdapterPull(
  adapterId: string,
  vehicleId: string,
): Promise<AdapterCallResult<Awaited<ReturnType<VehicleTelemetryAdapter['pull']>>>> {
  const adapter = getVehicleAdapter(adapterId);
  if (!adapter) {
    return { ok: false, degraded: true, reason: 'Unknown adapter', fallback: 'manual' };
  }
  let breaker = await loadBreaker(adapter.id, adapter.kind, adapter.displayName, adapter.mode);
  if (!isCircuitAllowingCalls(breaker) || injectedFailures.has(adapter.id)) {
    breaker = nextCircuitState(
      { ...breaker, last_error: injectedFailures.has(adapter.id) ? 'injected_failure' : 'circuit_open' },
      'failure',
    );
    await persistBreaker(breaker, {
      kind: adapter.kind,
      displayName: adapter.displayName,
      mode: adapter.mode,
    });
    return {
      ok: false,
      degraded: true,
      reason: 'Adapter unavailable — falling back to manual entry',
      fallback: 'manual',
    };
  }
  try {
    if (injectedFailures.has(adapter.id)) {
      throw new Error('injected_failure');
    }
    const data = await adapter.pull(vehicleId);
    breaker = nextCircuitState(breaker, 'success');
    await persistBreaker(breaker, {
      kind: adapter.kind,
      displayName: adapter.displayName,
      mode: adapter.mode,
    });
    return { ok: true, data, degraded: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'adapter_error';
    breaker = nextCircuitState({ ...breaker, last_error: msg }, 'failure');
    await persistBreaker(breaker, {
      kind: adapter.kind,
      displayName: adapter.displayName,
      mode: adapter.mode,
    });
    return {
      ok: false,
      degraded: true,
      reason: `Adapter error (${msg}) — use manual SOC / sessions`,
      fallback: 'manual',
    };
  }
}

export async function callOperatorFetchStations(adapterId: string) {
  const adapter = getOperatorAdapter(adapterId);
  if (!adapter) {
    return { ok: false as const, degraded: true as const, reason: 'Unknown operator adapter', fallback: 'manual' as const };
  }
  let breaker = await loadBreaker(adapter.id, 'operator', adapter.displayName, adapter.mode);
  if (!isCircuitAllowingCalls(breaker) || injectedFailures.has(adapter.id)) {
    breaker = nextCircuitState(
      { ...breaker, last_error: 'circuit_open_or_injected' },
      'failure',
    );
    await persistBreaker(breaker, { kind: 'operator', displayName: adapter.displayName, mode: adapter.mode });
    return {
      ok: false as const,
      degraded: true as const,
      reason: 'Operator adapter down — use seeded/demo catalog + manual sessions',
      fallback: 'manual' as const,
    };
  }
  try {
    const data = await adapter.fetchStations();
    breaker = nextCircuitState(breaker, 'success');
    await persistBreaker(breaker, { kind: 'operator', displayName: adapter.displayName, mode: adapter.mode });
    return { ok: true as const, data, degraded: false as const };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'adapter_error';
    breaker = nextCircuitState({ ...breaker, last_error: msg }, 'failure');
    await persistBreaker(breaker, { kind: 'operator', displayName: adapter.displayName, mode: adapter.mode });
    return {
      ok: false as const,
      degraded: true as const,
      reason: `Operator error (${msg}) — manual fallback`,
      fallback: 'manual' as const,
    };
  }
}

export async function ensureAdapterHealthSeeded() {
  for (const a of listVehicleAdapters()) {
    await loadBreaker(a.id, a.kind, a.displayName, a.mode);
  }
  for (const a of listOperatorAdapters()) {
    await loadBreaker(a.id, 'operator', a.displayName, a.mode);
  }
}

export async function resetCircuit(adapterId: string) {
  const row = await prisma.adapterHealth.findUnique({ where: { adapterId } });
  if (!row) return null;
  injectAdapterFailure(adapterId, false);
  return prisma.adapterHealth.update({
    where: { adapterId },
    data: {
      circuitState: 'closed',
      failureCount: 0,
      status: 'healthy',
      lastError: null,
      openedAt: null,
    },
  });
}

export async function forceOpenCircuit(adapterId: string, reason: string) {
  injectAdapterFailure(adapterId, true);
  return prisma.adapterHealth.upsert({
    where: { adapterId },
    create: {
      adapterId,
      kind: 'unknown',
      displayName: adapterId,
      mode: 'demo',
      status: 'degraded',
      circuitState: 'open',
      failureCount: 99,
      lastError: reason,
      openedAt: new Date(),
    },
    update: {
      status: 'degraded',
      circuitState: 'open',
      failureCount: { increment: 1 },
      lastError: reason,
      openedAt: new Date(),
      lastFailureAt: new Date(),
    },
  });
}
