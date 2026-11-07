import type { TelemetryObservation, VehicleTelemetryAdapter } from '@evsaathi/shared';

/**
 * Demo / simulated OEM read-only adapter (P3-M02).
 * Clearly labeled demo — NEVER claims LIVE. No ME4U scrape/RE.
 */
export const DEMO_OEM_ADAPTER_ID = 'demo_oem_mahindra_stub';

export class DemoOemAdapter implements VehicleTelemetryAdapter {
  readonly id = DEMO_OEM_ADAPTER_ID;
  readonly kind = 'oem' as const;
  readonly mode = 'demo' as const;
  readonly displayName = 'Demo OEM stub (Mahindra-style read-only)';
  readonly capabilities = ['pull'] as Array<'pull' | 'webhook' | 'import'>;

  async pull(vehicleId: string): Promise<TelemetryObservation | null> {
    // Deterministic fixture from vehicle id hash — not a live feed
    const seed = vehicleId.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const soc = 55 + (seed % 30);
    const observed = new Date();
    return {
      vehicle_id: vehicleId,
      observed_at: observed.toISOString(),
      soc_percent: soc,
      range_km: Math.round(soc * 4.2),
      odometer_km: 12_000 + (seed % 5000),
      charging_status: soc < 90 ? 'idle' : 'complete',
      energy: {
        charge_power_kw: null,
        efficiency_kwh_per_100km: 16.8,
      },
      source: 'oem',
      data_label: 'recently_synchronized',
      source_metadata: {
        adapter: this.id,
        mode: 'demo',
        confidence: 0.55,
        raw_ref: `fixture://${this.id}/${vehicleId}`,
        note:
          'SIMULATED / DEMO OEM stub — not a live Me4U or partner feed. Never labeled LIVE.',
      },
    };
  }
}

export const demoOemAdapter = new DemoOemAdapter();
