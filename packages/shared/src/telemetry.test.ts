import { describe, expect, it } from 'vitest';
import {
  isCircuitAllowingCalls,
  labelFromAdapterFreshness,
  nextCircuitState,
  sourceToDataLabel,
  freshnessAgeLabel,
  type CircuitBreakerState,
} from './telemetry';

describe('labelFromAdapterFreshness', () => {
  const now = new Date('2026-11-07T12:00:00Z');

  it('never labels demo/simulated as LIVE', () => {
    expect(
      labelFromAdapterFreshness({
        mode: 'demo',
        observedAt: now,
        now,
      }),
    ).toBe('recently_synchronized');
    expect(
      labelFromAdapterFreshness({
        mode: 'simulated',
        observedAt: now,
        now,
      }),
    ).toBe('recently_synchronized');
  });

  it('labels live-mode fresh samples as live', () => {
    expect(
      labelFromAdapterFreshness({
        mode: 'live',
        observedAt: new Date(now.getTime() - 30_000),
        now,
      }),
    ).toBe('live');
  });

  it('labels stale live-mode as recently_synchronized', () => {
    expect(
      labelFromAdapterFreshness({
        mode: 'live',
        observedAt: new Date(now.getTime() - 10 * 60_000),
        now,
      }),
    ).toBe('recently_synchronized');
  });
});

describe('sourceToDataLabel', () => {
  it('maps manual/import/estimated', () => {
    expect(sourceToDataLabel('manual')).toBe('manually_entered');
    expect(sourceToDataLabel('import')).toBe('imported');
    expect(sourceToDataLabel('estimated')).toBe('estimated');
  });
});

describe('circuit breaker', () => {
  const base: CircuitBreakerState = {
    adapter_id: 'demo_oem',
    state: 'closed',
    failure_count: 0,
    success_count: 0,
    last_checked_at: '2026-11-07T12:00:00Z',
  };

  it('opens after threshold failures', () => {
    const t0 = new Date('2026-11-07T12:00:00Z');
    let s = base;
    s = nextCircuitState(s, 'failure', { openThreshold: 3, now: t0 });
    s = nextCircuitState(s, 'failure', { openThreshold: 3, now: t0 });
    s = nextCircuitState(s, 'failure', { openThreshold: 3, now: t0 });
    expect(s.state).toBe('open');
    expect(isCircuitAllowingCalls(s, new Date('2026-11-07T12:00:30Z'), 60_000)).toBe(false);
    expect(isCircuitAllowingCalls(s, new Date('2026-11-07T12:02:00Z'), 60_000)).toBe(true);
  });

  it('resets on success', () => {
    let s = nextCircuitState(
      { ...base, failure_count: 2, state: 'closed' },
      'success',
    );
    expect(s.state).toBe('closed');
    expect(s.failure_count).toBe(0);
  });
});

describe('freshnessAgeLabel', () => {
  it('formats ages', () => {
    const now = new Date('2026-11-07T12:00:00Z');
    expect(freshnessAgeLabel(new Date(now.getTime() - 30_000), now)).toBe('Just now');
    expect(freshnessAgeLabel(new Date(now.getTime() - 5 * 60_000), now)).toBe('5 min ago');
  });
});
