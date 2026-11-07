import { describe, expect, it } from 'vitest';
import {
  decideAiTool,
  AI_DENIED_TOOLS,
  computeAdvancedAnalytics,
  labelFromAdapterFreshness,
  nextCircuitState,
} from '@evsaathi/shared';
import { DemoOemAdapter } from './adapters/demo-oem';
import { DemoOperatorAdapter } from './adapters/demo-operator';

describe('Phase 3 adapter contracts', () => {
  it('demo OEM pull is simulated and never LIVE-labeled', async () => {
    const adapter = new DemoOemAdapter();
    const obs = await adapter.pull('vehicle-fixture-1');
    expect(obs).not.toBeNull();
    expect(adapter.mode).toBe('demo');
    expect(obs!.data_label).not.toBe('live');
    expect(obs!.source_metadata.mode).toBe('demo');
    expect(obs!.source_metadata.note).toMatch(/DEMO|SIMULATED/i);
  });

  it('demo operator catalog marks demo provenance and null availability', async () => {
    const adapter = new DemoOperatorAdapter();
    const stations = await adapter.fetchStations();
    expect(stations.length).toBeGreaterThan(0);
    expect(stations.every((s) => s.provenance.source === 'demo')).toBe(true);
    expect(stations.every((s) => s.connectors.every((c) => c.available === null))).toBe(true);
    expect(adapter.capabilities.remote_commands).toBe(false);
  });

  it('demo operator session intelligence is clearly simulated', async () => {
    const adapter = new DemoOperatorAdapter();
    const sess = await adapter.fetchSession('demo-sess-abc');
    expect(sess?.provenance.mode).toBe('demo');
    expect(sess?.provenance.note).toMatch(/SIMULATED/i);
  });
});

describe('Phase 3 AI deny-list contract', () => {
  it('denies every actuator tool', () => {
    for (const t of AI_DENIED_TOOLS) {
      expect(decideAiTool(t).allowed).toBe(false);
    }
  });

  it('allows explainable read tools', () => {
    expect(decideAiTool('search_stations').allowed).toBe(true);
    expect(decideAiTool('summarize_battery').allowed).toBe(true);
  });
});

describe('Phase 3 freshness + degradation contracts', () => {
  it('demo freshness never becomes live', () => {
    expect(
      labelFromAdapterFreshness({
        mode: 'demo',
        observedAt: new Date(),
      }),
    ).toBe('recently_synchronized');
  });

  it('circuit opens after failures for graceful degradation', () => {
    let s = nextCircuitState(
      {
        adapter_id: 'demo_oem_mahindra_stub',
        state: 'closed',
        failure_count: 0,
        success_count: 0,
        last_checked_at: new Date().toISOString(),
      },
      'failure',
      { openThreshold: 2 },
    );
    s = nextCircuitState(s, 'failure', { openThreshold: 2 });
    expect(s.state).toBe('open');
  });

  it('advanced analytics reports richness without inventing health', () => {
    const r = computeAdvancedAnalytics({
      usableKwh: 79,
      telemetry: [],
      sessions: [],
    });
    expect(r.richness).toBe('manual_sparse');
    expect(r).not.toHaveProperty('battery_health_percent');
  });
});
