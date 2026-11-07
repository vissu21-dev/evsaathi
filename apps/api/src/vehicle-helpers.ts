import {
  estimateRange,
  freshnessAgeLabel,
  resolveUsableKwh,
  sourceToDataLabel,
  type DataSourceLabel,
} from '@evsaathi/shared';
import { prisma } from './prisma';

export function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function getVehicleForUser(vehicleId: string, userId: string) {
  return prisma.vehicle.findFirst({
    where: { id: vehicleId, userId, deletedAt: null },
    include: { vehicleSpec: true },
  });
}

export function effectiveSpec(vehicle: {
  specOverridesJson: string;
  vehicleSpec: {
    batteryKwhStated: number;
    batteryKwhUsable: number | null;
    usableEqualsStated: boolean;
    efficiencyWhPerKmCity: number;
    efficiencyWhPerKmHighway: number;
    maxAcKw: number;
    maxDcKw: number;
    connectorTypesJson: string;
    recommendedChargeLimitPercent: number;
  };
}) {
  const overrides = parseJson<Record<string, number | null>>(vehicle.specOverridesJson, {});
  const usable = resolveUsableKwh({
    battery_kwh_stated: vehicle.vehicleSpec.batteryKwhStated,
    battery_kwh_usable: vehicle.vehicleSpec.batteryKwhUsable,
    usable_equals_stated: vehicle.vehicleSpec.usableEqualsStated,
    override_usable: overrides.battery_kwh_usable ?? null,
  });
  const effHighway =
    overrides.efficiency_wh_per_km_highway ??
    vehicle.vehicleSpec.efficiencyWhPerKmHighway;
  const effCity =
    overrides.efficiency_wh_per_km_city ?? vehicle.vehicleSpec.efficiencyWhPerKmCity;
  return {
    usableKwh: usable.usableKwh,
    usableNote: usable.note,
    usableAssumed: usable.assumed,
    efficiencyWhPerKmHighway: effHighway,
    efficiencyWhPerKmCity: effCity,
    maxAcKw: overrides.max_ac_kw ?? vehicle.vehicleSpec.maxAcKw,
    maxDcKw: overrides.max_dc_kw ?? vehicle.vehicleSpec.maxDcKw,
    connectorTypes: parseJson<string[]>(vehicle.vehicleSpec.connectorTypesJson, []),
    recommendedChargeLimitPercent:
      overrides.recommended_charge_limit_percent ??
      vehicle.vehicleSpec.recommendedChargeLimitPercent,
  };
}

export async function buildDashboard(vehicleId: string, userId: string) {
  const vehicle = await getVehicleForUser(vehicleId, userId);
  if (!vehicle) return null;

  const spec = effectiveSpec(vehicle);
  const latest = await prisma.telemetry.findFirst({
    where: { vehicleId },
    orderBy: { observedAt: 'desc' },
  });

  const lastCharge = await prisma.chargingSession.findFirst({
    where: { vehicleId, status: 'completed' },
    orderBy: { endedAt: 'desc' },
  });

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const todaySessions = await prisma.chargingSession.findMany({
    where: { vehicleId, startedAt: { gte: dayStart } },
  });

  // Consumption from last two SOC samples with odometer if available
  const samples = await prisma.telemetry.findMany({
    where: { vehicleId, odometerKm: { not: null } },
    orderBy: { observedAt: 'desc' },
    take: 20,
  });

  let consumption: number | null = null;
  if (samples.length >= 2) {
    const newest = samples[0];
    const oldest = samples[samples.length - 1];
    const dist = (newest.odometerKm ?? 0) - (oldest.odometerKm ?? 0);
    const socDelta = (oldest.socPercent - newest.socPercent) / 100;
    if (dist > 5 && socDelta > 0) {
      const energy = socDelta * spec.usableKwh;
      consumption = (energy / dist) * 100;
    }
  }

  const soc = latest?.socPercent ?? null;
  const adapterMode =
    latest?.source === 'oem' || latest?.source === 'telematics' || latest?.source === 'operator_session'
      ? vehicle.oemLinkStatus === 'demo_linked' || vehicle.oemLinkStatus === 'linked'
        ? ('demo' as const)
        : ('offline' as const)
      : undefined;
  const dataLabel: DataSourceLabel = latest
    ? sourceToDataLabel(latest.source, {
        mode: adapterMode,
        observedAt: latest.observedAt,
      })
    : 'estimated';

  // Hard rule: demo/simulated OEM never surfaces as LIVE even if source=oem
  const safeLabel: DataSourceLabel =
    dataLabel === 'live' && vehicle.oemLinkStatus !== 'live_linked' ? 'recently_synchronized' : dataLabel;

  const range =
    soc != null
      ? estimateRange({
          socPercent: soc,
          usableKwh: spec.usableKwh,
          efficiencyWhPerKm: consumption
            ? (consumption / 100) * 1000
            : spec.efficiencyWhPerKmHighway,
        })
      : null;

  const lastChargeLabel: DataSourceLabel = lastCharge
    ? sourceToDataLabel(lastCharge.source)
    : 'manually_entered';

  return {
    vehicle_id: vehicle.id,
    nickname: vehicle.nickname,
    make: vehicle.make,
    model: vehicle.model,
    variant: vehicle.variant,
    soc_percent: soc,
    range_km: range?.rangeKmWithReserve ?? null,
    range_confidence: range?.confidence ?? null,
    usable_kwh_remaining: range?.usableKwhAtSoc ?? null,
    usable_kwh_pack: spec.usableKwh,
    usable_note: spec.usableNote,
    consumption_recent_kwh_per_100km: consumption != null ? Math.round(consumption * 10) / 10 : null,
    today_distance_km: null,
    today_energy_kwh: todaySessions.reduce((s, x) => s + (x.energyKwh ?? 0), 0) || null,
    last_charge: lastCharge
      ? {
          ended_at: lastCharge.endedAt,
          energy_kwh: lastCharge.energyKwh,
          cost_paise: lastCharge.costPaiseActual ?? lastCharge.costPaiseEstimated,
          data_label: lastChargeLabel === 'live' ? 'recently_synchronized' : lastChargeLabel,
          source: lastCharge.source,
        }
      : null,
    charging: { active: false },
    battery_health: null,
    connectivity: {
      last_sync_at: latest?.observedAt ?? null,
      freshness: freshnessAgeLabel(latest?.observedAt ?? null),
      oem_link_status: vehicle.oemLinkStatus,
      oem_adapter_id: vehicle.oemAdapterId,
      operator_adapter_id: vehicle.operatorAdapterId,
      telemetry_source_preferred: vehicle.telemetrySourcePreferred,
      data_label: safeLabel,
      live_claim: vehicle.oemLinkStatus === 'live_linked',
    },
    range_assumptions: range?.assumptions ?? [],
    data_label: safeLabel,
    labels_note:
      vehicle.oemLinkStatus === 'demo_linked'
        ? 'Demo OEM stub linked — SYNCED/simulated only. Never LIVE without an authorized feed.'
        : vehicle.oemLinkStatus === 'live_linked'
          ? 'Authorized live vehicle feed connected.'
          : 'Manual/import path active. Demo OEM/operator adapters available with consent — still not LIVE.',
  };
}
