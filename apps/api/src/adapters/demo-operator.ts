import type {
  ChargingOperatorAdapter,
  NormalizedOperatorStation,
  OperatorSessionSnapshot,
} from '@evsaathi/shared';

/**
 * Demo charging-operator adapter (P3-M03).
 * Directory + optional session sync fixtures with clear provenance.
 * No scraping; not LIVE availability.
 */
export const DEMO_OPERATOR_ADAPTER_ID = 'demo_operator_ocpi_stub';

const DEMO_STATIONS: NormalizedOperatorStation[] = [
  {
    external_id: 'demo-op-blr-orion',
    name: 'Demo Hub — Orion Mall CCS2',
    operator: 'DemoCharge India',
    lat: 13.011,
    lng: 77.555,
    address: 'Orion Mall, Bengaluru (demo)',
    connectors: [
      { type: 'CCS2', max_kw: 60, count: 2, available: null },
      { type: 'Type2', max_kw: 22, count: 1, available: null },
    ],
    tariff_inr_per_kwh: 18,
    status: 'demo',
    provenance: {
      source: 'demo',
      mode: 'demo',
      fetched_at: new Date().toISOString(),
      license: 'EVSaathi demo seed — not operator authoritative',
      note: 'Demo catalog — availability intentionally null (not LIVE)',
    },
  },
  {
    external_id: 'demo-op-nh48-tumakuru',
    name: 'Demo Corridor — NH48 Tumakuru',
    operator: 'DemoCharge India',
    lat: 13.34,
    lng: 77.1,
    address: 'NH48 Tumakuru halt (demo)',
    connectors: [{ type: 'CCS2', max_kw: 120, count: 4, available: null }],
    tariff_inr_per_kwh: 20,
    status: 'demo',
    provenance: {
      source: 'demo',
      mode: 'demo',
      fetched_at: new Date().toISOString(),
      license: 'EVSaathi demo seed',
      note: 'Simulated OCPI Locations-shaped fixture',
    },
  },
];

export class DemoOperatorAdapter implements ChargingOperatorAdapter {
  readonly id = DEMO_OPERATOR_ADAPTER_ID;
  readonly displayName = 'Demo Operator OCPI stub';
  readonly mode = 'demo' as const;
  readonly capabilities = {
    catalog: true,
    availability: false,
    tariffs: true,
    session_sync: true,
    remote_commands: false,
  };

  async fetchStations(): Promise<NormalizedOperatorStation[]> {
    const fetched = new Date().toISOString();
    return DEMO_STATIONS.map((s) => ({
      ...s,
      provenance: { ...s.provenance, fetched_at: fetched },
    }));
  }

  async fetchSession(externalSessionId: string): Promise<OperatorSessionSnapshot | null> {
    if (!externalSessionId.startsWith('demo-sess-')) return null;
    const now = new Date();
    const started = new Date(now.getTime() - 25 * 60_000);
    return {
      external_session_id: externalSessionId,
      station_external_id: 'demo-op-blr-orion',
      status: 'active',
      energy_kwh: 18.4,
      power_kw: 48,
      soc_percent: 62,
      cost_paise: 33120,
      started_at: started.toISOString(),
      updated_at: now.toISOString(),
      series: [
        { t: 0, power_kw: 52, soc: 40 },
        { t: 300, power_kw: 50, soc: 48 },
        { t: 600, power_kw: 48, soc: 55 },
        { t: 900, power_kw: 48, soc: 62 },
      ],
      provenance: {
        source: 'demo',
        mode: 'demo',
        note: 'SIMULATED session intelligence — not a live operator CDR/session feed',
      },
    };
  }

  async listDemoSessions(vehicleId: string): Promise<OperatorSessionSnapshot[]> {
    const sess = await this.fetchSession(`demo-sess-${vehicleId.slice(0, 8)}`);
    return sess ? [sess] : [];
  }
}

export const demoOperatorAdapter = new DemoOperatorAdapter();
