import { Router } from 'express';
import { z } from 'zod';
import {
  estimateChargeCost,
  estimateChargeTime,
  estimateRange,
  estimateTripEnergy,
  haversineKm,
  selectStopsForStrategy,
  strategyComparison,
  type StationCandidate,
  type TripStrategy,
} from '@evsaathi/shared';
import { prisma } from './prisma';
import { requestOtp, requireAuth, verifyOtp } from './auth';
import { sendError } from './errors';
import {
  buildDashboard,
  effectiveSpec,
  getVehicleForUser,
  parseJson,
} from './vehicle-helpers';
import { phase2Router } from './phase2-routes';
import { phase3Router } from './phase3-routes';
import {
  createInAppNotification,
  reliabilitySummary,
} from './reliability-service';

export const router = Router();

router.use(phase2Router);
router.use(phase3Router);

router.get('/health', (_req, res) => {
  res.json({
    ok: true,
    product: 'EVSaathi',
    phase: 3,
    oem_integration: 'demo_stub_only',
    operator_integration: 'demo_stub_only',
    ai_assistant: true,
    ai_actuators: false,
    reliability: 'crowdsource',
    notifications: process.env.FCM_SERVER_KEY ? 'fcm_and_inbox' : 'inapp_inbox_only',
    note: 'Phase 3 Integrations + AI — demo adapters never claim LIVE; AI hard-denies actuators',
  });
});

// ── Auth ──────────────────────────────────────────────
router.post('/auth/otp/request', async (req, res) => {
  const body = z.object({ phone_e164: z.string().min(10).max(16) }).safeParse(req.body);
  if (!body.success) return sendError(res, 400, 'VALIDATION', 'Invalid phone', body.error.flatten());
  const phone = body.data.phone_e164.replace(/\s/g, '');
  if (!/^\+91\d{10}$/.test(phone) && !/^\d{10}$/.test(phone)) {
    return sendError(res, 400, 'VALIDATION', 'Use +91XXXXXXXXXX or 10-digit Indian mobile');
  }
  const phoneE164 = phone.startsWith('+') ? phone : `+91${phone}`;
  const result = await requestOtp(phoneE164);
  res.json(result);
});

router.post('/auth/otp/verify', async (req, res) => {
  const body = z
    .object({
      request_id: z.string().uuid(),
      code: z.string().min(4).max(8),
      device_id: z.string().min(3),
    })
    .safeParse(req.body);
  if (!body.success) return sendError(res, 400, 'VALIDATION', 'Invalid payload', body.error.flatten());
  const result = await verifyOtp({
    requestId: body.data.request_id,
    code: body.data.code,
    deviceId: body.data.device_id,
  });
  if (!result.ok) return sendError(res, 401, 'OTP_INVALID', result.error);
  res.json(result);
});

router.post('/auth/logout', requireAuth, async (_req, res) => {
  res.json({ ok: true });
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    include: { preferences: true },
  });
  if (!user) return sendError(res, 404, 'NOT_FOUND', 'User not found');
  res.json({
    id: user.id,
    phone_e164: user.phoneE164,
    display_name: user.displayName,
    locale: user.locale,
    role: user.role,
    preferences: user.preferences,
  });
});

router.patch('/me', requireAuth, async (req, res) => {
  const body = z
    .object({ display_name: z.string().min(1).max(80).optional(), locale: z.string().optional() })
    .safeParse(req.body);
  if (!body.success) return sendError(res, 400, 'VALIDATION', 'Invalid', body.error.flatten());
  const user = await prisma.user.update({
    where: { id: req.user!.id },
    data: {
      displayName: body.data.display_name,
      locale: body.data.locale,
    },
  });
  res.json({ id: user.id, display_name: user.displayName, locale: user.locale });
});

// ── Vehicle specs & vehicles ──────────────────────────
router.get('/vehicle-specs', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : undefined;
  const specs = await prisma.vehicleSpec.findMany({
    where: q
      ? {
          OR: [
            { make: { contains: q } },
            { model: { contains: q } },
            { variant: { contains: q } },
          ],
        }
      : undefined,
    orderBy: [{ make: 'asc' }, { model: 'asc' }],
  });
  res.json({
    data: specs.map((s) => ({
      id: s.id,
      make: s.make,
      model: s.model,
      variant: s.variant,
      model_year: s.modelYear,
      battery_kwh_stated: s.batteryKwhStated,
      battery_kwh_usable: s.batteryKwhUsable,
      usable_equals_stated: s.usableEqualsStated,
      efficiency_wh_per_km_city: s.efficiencyWhPerKmCity,
      efficiency_wh_per_km_highway: s.efficiencyWhPerKmHighway,
      max_ac_kw: s.maxAcKw,
      max_dc_kw: s.maxDcKw,
      connector_types: parseJson(s.connectorTypesJson, []),
      source: s.source,
    })),
  });
});

router.get('/vehicle-specs/:id', async (req, res) => {
  const s = await prisma.vehicleSpec.findUnique({ where: { id: req.params.id } });
  if (!s) return sendError(res, 404, 'NOT_FOUND', 'Spec not found');
  res.json({
    ...s,
    connector_types: parseJson(s.connectorTypesJson, []),
    source_metadata: parseJson(s.sourceMetadataJson, {}),
  });
});

router.get('/vehicles', requireAuth, async (req, res) => {
  const vehicles = await prisma.vehicle.findMany({
    where: { userId: req.user!.id, deletedAt: null },
    include: { vehicleSpec: true },
    orderBy: { createdAt: 'asc' },
  });
  res.json({
    data: vehicles.map((v) => ({
      id: v.id,
      nickname: v.nickname,
      make: v.make,
      model: v.model,
      variant: v.variant,
      is_primary: v.isPrimary,
      oem_link_status: v.oemLinkStatus,
      vehicle_spec_id: v.vehicleSpecId,
      spec_overrides: parseJson(v.specOverridesJson, {}),
      telemetry_source_preferred: v.telemetrySourcePreferred,
    })),
  });
});

router.post('/vehicles', requireAuth, async (req, res) => {
  const body = z
    .object({
      vehicle_spec_id: z.string().uuid(),
      nickname: z.string().min(1).max(60).optional(),
      model_year: z.number().int().optional(),
      is_primary: z.boolean().optional(),
      registration_no: z.string().optional(),
      spec_overrides: z.record(z.union([z.number(), z.null()])).optional(),
    })
    .safeParse(req.body);
  if (!body.success) return sendError(res, 400, 'VALIDATION', 'Invalid', body.error.flatten());

  const spec = await prisma.vehicleSpec.findUnique({ where: { id: body.data.vehicle_spec_id } });
  if (!spec) return sendError(res, 404, 'NOT_FOUND', 'Vehicle spec not found');

  if (body.data.is_primary !== false) {
    await prisma.vehicle.updateMany({
      where: { userId: req.user!.id },
      data: { isPrimary: false },
    });
  }

  const vehicle = await prisma.vehicle.create({
    data: {
      userId: req.user!.id,
      vehicleSpecId: spec.id,
      nickname: body.data.nickname ?? `${spec.make} ${spec.model}`,
      make: spec.make,
      model: spec.model,
      variant: spec.variant,
      modelYear: body.data.model_year ?? spec.modelYear,
      registrationNo: body.data.registration_no,
      isPrimary: body.data.is_primary !== false,
      specOverridesJson: JSON.stringify(body.data.spec_overrides ?? {}),
      oemLinkStatus: 'none',
      telemetrySourcePreferred: 'manual',
    },
  });
  res.status(201).json({ id: vehicle.id, nickname: vehicle.nickname });
});

router.get('/vehicles/:id', requireAuth, async (req, res) => {
  const v = await getVehicleForUser(req.params.id, req.user!.id);
  if (!v) return sendError(res, 404, 'NOT_FOUND', 'Vehicle not found');
  const spec = effectiveSpec(v);
  res.json({
    id: v.id,
    nickname: v.nickname,
    make: v.make,
    model: v.model,
    variant: v.variant,
    is_primary: v.isPrimary,
    oem_link_status: v.oemLinkStatus,
    telemetry_source_preferred: v.telemetrySourcePreferred,
    spec_overrides: parseJson(v.specOverridesJson, {}),
    effective: spec,
    vehicle_spec: {
      id: v.vehicleSpec.id,
      battery_kwh_stated: v.vehicleSpec.batteryKwhStated,
      battery_kwh_usable: v.vehicleSpec.batteryKwhUsable,
      usable_equals_stated: v.vehicleSpec.usableEqualsStated,
    },
  });
});

router.patch('/vehicles/:id', requireAuth, async (req, res) => {
  const v = await getVehicleForUser(req.params.id, req.user!.id);
  if (!v) return sendError(res, 404, 'NOT_FOUND', 'Vehicle not found');
  const body = z
    .object({
      nickname: z.string().optional(),
      spec_overrides: z.record(z.union([z.number(), z.null()])).optional(),
      is_primary: z.boolean().optional(),
    })
    .safeParse(req.body);
  if (!body.success) return sendError(res, 400, 'VALIDATION', 'Invalid', body.error.flatten());
  if (body.data.is_primary) {
    await prisma.vehicle.updateMany({
      where: { userId: req.user!.id },
      data: { isPrimary: false },
    });
  }
  const updated = await prisma.vehicle.update({
    where: { id: v.id },
    data: {
      nickname: body.data.nickname,
      isPrimary: body.data.is_primary,
      specOverridesJson: body.data.spec_overrides
        ? JSON.stringify(body.data.spec_overrides)
        : undefined,
    },
  });
  res.json({ id: updated.id, nickname: updated.nickname });
});

router.get('/vehicles/:id/dashboard', requireAuth, async (req, res) => {
  const dash = await buildDashboard(req.params.id, req.user!.id);
  if (!dash) return sendError(res, 404, 'NOT_FOUND', 'Vehicle not found');
  res.json(dash);
});

router.post('/vehicles/:id/telemetry', requireAuth, async (req, res) => {
  const v = await getVehicleForUser(req.params.id, req.user!.id);
  if (!v) return sendError(res, 404, 'NOT_FOUND', 'Vehicle not found');
  const body = z
    .object({
      observed_at: z.string().datetime().optional(),
      soc_percent: z.number().min(0).max(100),
      odometer_km: z.number().min(0).optional(),
      range_km_est: z.number().min(0).optional(),
      source: z.enum(['manual', 'import']).default('manual'),
      lat: z.number().optional(),
      lng: z.number().optional(),
    })
    .safeParse(req.body);
  if (!body.success) return sendError(res, 400, 'VALIDATION', 'Invalid SOC payload', body.error.flatten());

  const row = await prisma.telemetry.create({
    data: {
      vehicleId: v.id,
      observedAt: body.data.observed_at ? new Date(body.data.observed_at) : new Date(),
      socPercent: body.data.soc_percent,
      odometerKm: body.data.odometer_km,
      rangeKmEst: body.data.range_km_est,
      source: body.data.source,
      lat: body.data.lat,
      lng: body.data.lng,
      createdBy: req.user!.id,
      confidence: 90,
    },
  });

  res.status(201).json({
    id: row.id,
    soc_percent: row.socPercent,
    observed_at: row.observedAt,
    data_label: body.data.source === 'import' ? 'imported' : 'manually_entered',
  });
});

router.get('/vehicles/:id/telemetry', requireAuth, async (req, res) => {
  const v = await getVehicleForUser(req.params.id, req.user!.id);
  if (!v) return sendError(res, 404, 'NOT_FOUND', 'Vehicle not found');
  const rows = await prisma.telemetry.findMany({
    where: { vehicleId: v.id },
    orderBy: { observedAt: 'desc' },
    take: 50,
  });
  res.json({
    data: rows.map((r) => ({
      id: r.id,
      soc_percent: r.socPercent,
      odometer_km: r.odometerKm,
      observed_at: r.observedAt,
      source: r.source,
      data_label: r.source === 'manual' ? 'manually_entered' : 'imported',
    })),
  });
});

router.post('/vehicles/:id/range', requireAuth, async (req, res) => {
  const v = await getVehicleForUser(req.params.id, req.user!.id);
  if (!v) return sendError(res, 404, 'NOT_FOUND', 'Vehicle not found');
  const body = z
    .object({
      soc_percent: z.number().min(0).max(100),
      efficiency_wh_per_km: z.number().positive().optional(),
      safety_reserve_percent: z.number().min(0).max(30).optional(),
    })
    .safeParse(req.body);
  if (!body.success) return sendError(res, 400, 'VALIDATION', 'Invalid', body.error.flatten());
  const spec = effectiveSpec(v);
  const result = estimateRange({
    socPercent: body.data.soc_percent,
    usableKwh: spec.usableKwh,
    efficiencyWhPerKm: body.data.efficiency_wh_per_km ?? spec.efficiencyWhPerKmHighway,
    safetyReservePercent: body.data.safety_reserve_percent,
  });
  res.json({ ...result, usable_note: spec.usableNote });
});

router.get('/vehicles/:id/analytics/consumption', requireAuth, async (req, res) => {
  const v = await getVehicleForUser(req.params.id, req.user!.id);
  if (!v) return sendError(res, 404, 'NOT_FOUND', 'Vehicle not found');
  const period = (req.query.period as string) || 'week';
  const days = period === 'month' ? 30 : period === 'day' ? 1 : 7;
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const sessions = await prisma.chargingSession.findMany({
    where: { vehicleId: v.id, startedAt: { gte: from }, status: 'completed' },
    orderBy: { startedAt: 'asc' },
  });
  const telemetry = await prisma.telemetry.findMany({
    where: { vehicleId: v.id, observedAt: { gte: from } },
    orderBy: { observedAt: 'asc' },
  });

  const byDay: Record<string, { energy_kwh: number; cost_paise: number; soc_samples: number }> = {};
  for (const s of sessions) {
    const key = (s.endedAt ?? s.startedAt).toISOString().slice(0, 10);
    byDay[key] ??= { energy_kwh: 0, cost_paise: 0, soc_samples: 0 };
    byDay[key].energy_kwh += s.energyKwh ?? 0;
    byDay[key].cost_paise += s.costPaiseActual ?? s.costPaiseEstimated ?? 0;
  }
  for (const t of telemetry) {
    const key = t.observedAt.toISOString().slice(0, 10);
    byDay[key] ??= { energy_kwh: 0, cost_paise: 0, soc_samples: 0 };
    byDay[key].soc_samples += 1;
  }

  const series = Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, ...v }));

  const totalEnergy = sessions.reduce((a, s) => a + (s.energyKwh ?? 0), 0);
  const totalCost = sessions.reduce(
    (a, s) => a + (s.costPaiseActual ?? s.costPaiseEstimated ?? 0),
    0,
  );

  // kWh/km from odometer span if possible
  const withOdo = telemetry.filter((t) => t.odometerKm != null);
  let kwh_per_km: number | null = null;
  let kwh_per_100km: number | null = null;
  if (withOdo.length >= 2) {
    const first = withOdo[0];
    const last = withOdo[withOdo.length - 1];
    const dist = (last.odometerKm ?? 0) - (first.odometerKm ?? 0);
    const socDrop = (first.socPercent - last.socPercent) / 100;
    const spec = effectiveSpec(v);
    if (dist > 1 && socDrop > 0) {
      const energy = socDrop * spec.usableKwh;
      kwh_per_km = energy / dist;
      kwh_per_100km = kwh_per_km * 100;
    }
  }

  res.json({
    period,
    series,
    totals: {
      energy_kwh: Math.round(totalEnergy * 1000) / 1000,
      cost_paise: totalCost,
      session_count: sessions.length,
      kwh_per_km,
      kwh_per_100km,
    },
    data_label: series.length ? 'manually_entered' : 'estimated',
    note: series.length
      ? 'Charts from your logged sessions and SOC entries'
      : 'No logged data yet — empty state',
  });
});

// ── Stations ──────────────────────────────────────────
router.get('/stations/search', async (req, res) => {
  const lat = parseFloat(String(req.query.lat ?? '19.076'));
  const lng = parseFloat(String(req.query.lng ?? '72.877'));
  const radius_m = parseFloat(String(req.query.radius_m ?? '500000'));
  const current = req.query.current as string | undefined;
  const min_power_kw = req.query.min_power_kw
    ? parseFloat(String(req.query.min_power_kw))
    : undefined;
  const connectors = req.query.connectors
    ? String(req.query.connectors).split(',').map((s) => s.trim())
    : undefined;
  const vehicleId = req.query.vehicle_id as string | undefined;

  let vehicleConnectors: string[] | null = null;
  if (vehicleId && req.headers.authorization) {
    // optional compatibility — if auth present
  }

  const stations = await prisma.station.findMany({
    where: { deletedAt: null, status: 'active' },
    include: { operator: true, connectors: true, tariffs: true },
  });

  let vehicleTypes: string[] | undefined;
  if (vehicleId) {
    const v = await prisma.vehicle.findFirst({
      where: { id: vehicleId },
      include: { vehicleSpec: true },
    });
    if (v) vehicleTypes = parseJson(v.vehicleSpec.connectorTypesJson, []);
  }

  const data = stations
    .map((s) => {
      const distance_m = haversineKm({ lat, lng }, { lat: s.lat, lng: s.lng }) * 1000;
      let filteredConnectors = s.connectors;
      if (current) filteredConnectors = filteredConnectors.filter((c) => c.currentType === current);
      if (min_power_kw != null)
        filteredConnectors = filteredConnectors.filter((c) => c.powerKw >= min_power_kw);
      if (connectors?.length)
        filteredConnectors = filteredConnectors.filter((c) =>
          connectors.includes(c.connectorType),
        );
      const compatible =
        !vehicleTypes ||
        s.connectors.some((c) => vehicleTypes!.includes(c.connectorType));
      return {
        id: s.id,
        name: s.name,
        operator: s.operator
          ? { id: s.operator.id, name: s.operator.name, code: s.operator.code }
          : null,
        location: { lat: s.lat, lng: s.lng },
        city: s.city,
        state: s.state,
        distance_m: Math.round(distance_m),
        connectors: groupConnectors(filteredConnectors.length ? filteredConnectors : s.connectors),
        compatible,
        tariff_hint_paise_per_kwh: s.tariffs[0]?.energyRatePaise ?? null,
        availability_summary: 'unknown',
        reliability: reliabilitySummary(s),
        last_verified_at: s.lastVerifiedAt?.toISOString() ?? null,
        open_now: s.isOpen24x7,
        amenities: parseJson(s.amenitiesJson, [] as string[]),
        data_freshness: 'manually_entered',
        is_demo: s.isDemo,
        matches_filters: filteredConnectors.length > 0 || (!current && !min_power_kw && !connectors),
      };
    })
    .filter((s) => s.distance_m <= radius_m)
    .filter((s) => s.matches_filters)
    .sort((a, b) => a.distance_m - b.distance_m);

  res.json({
    data,
    next_cursor: null,
    banner: data.some((d) => d.is_demo)
      ? 'Demo stations — catalog is seeded; not live operator availability or prices. Reliability is crowdsource, not operator telemetry.'
      : null,
  });
});

router.get('/stations/:id', async (req, res) => {
  const s = await prisma.station.findFirst({
    where: { id: req.params.id, deletedAt: null },
    include: { operator: true, connectors: true, tariffs: true },
  });
  if (!s) return sendError(res, 404, 'NOT_FOUND', 'Station not found');
  res.json({
    id: s.id,
    name: s.name,
    operator: s.operator
      ? { id: s.operator.id, name: s.operator.name, code: s.operator.code }
      : null,
    address: {
      line: s.addressLine,
      city: s.city,
      state: s.state,
      pincode: s.pincode,
    },
    location: { lat: s.lat, lng: s.lng },
    amenities: parseJson(s.amenitiesJson, []),
    access_type: s.accessType,
    is_open_24x7: s.isOpen24x7,
    opening_hours: parseJson(s.openingHoursJson ?? 'null', null),
    connectors: s.connectors.map((c) => ({
      id: c.id,
      type: c.connectorType,
      power_kw: c.powerKw,
      current_type: c.currentType,
      status_nominal: c.statusNominal,
      status_note: 'Catalog hint only — not live availability',
    })),
    tariffs: s.tariffs.map((t) => ({
      pricing_model: t.pricingModel,
      energy_rate_paise: t.energyRatePaise,
      session_fee_paise: t.sessionFeePaise,
      currency: t.currency,
      data_label: 'manually_entered',
      note: s.isDemo ? 'Demo tariff seed' : undefined,
    })),
    reliability: reliabilitySummary(s),
    last_verified_at: s.lastVerifiedAt?.toISOString() ?? null,
    verification_note:
      'Last verified = trusted crowd report or admin check — not OEM/operator live ping',
    nav: {
      google_maps: `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`,
    },
    is_demo: s.isDemo,
    data_freshness: 'manually_entered',
  });
});

function groupConnectors(
  connectors: { connectorType: string; powerKw: number; currentType: string }[],
) {
  const map = new Map<string, { type: string; power_kw: number; current_type: string; count: number }>();
  for (const c of connectors) {
    const key = `${c.connectorType}-${c.powerKw}-${c.currentType}`;
    const cur = map.get(key);
    if (cur) cur.count += 1;
    else
      map.set(key, {
        type: c.connectorType,
        power_kw: c.powerKw,
        current_type: c.currentType,
        count: 1,
      });
  }
  return [...map.values()];
}

// ── Sessions & costs ──────────────────────────────────
router.get('/sessions', requireAuth, async (req, res) => {
  const sessions = await prisma.chargingSession.findMany({
    where: { userId: req.user!.id },
    include: { station: true },
    orderBy: { startedAt: 'desc' },
    take: 50,
  });
  res.json({
    data: sessions.map((s) => ({
      id: s.id,
      vehicle_id: s.vehicleId,
      station: s.station
        ? { id: s.station.id, name: s.station.name, is_demo: s.station.isDemo }
        : null,
      started_at: s.startedAt,
      ended_at: s.endedAt,
      status: s.status,
      energy_kwh: s.energyKwh,
      soc_start: s.socStart,
      soc_end: s.socEnd,
      cost_paise: s.costPaiseActual ?? s.costPaiseEstimated,
      source: s.source,
      data_label: 'manually_entered',
    })),
  });
});

router.post('/sessions', requireAuth, async (req, res) => {
  const body = z
    .object({
      vehicle_id: z.string().uuid(),
      station_id: z.string().uuid().optional().nullable(),
      started_at: z.string().datetime().optional(),
      ended_at: z.string().datetime().optional(),
      soc_start: z.number().min(0).max(100),
      soc_end: z.number().min(0).max(100),
      energy_kwh: z.number().positive().optional(),
      max_power_kw: z.number().positive().optional(),
      rate_paise_per_kwh: z.number().int().positive().optional(),
      session_fee_paise: z.number().int().min(0).optional(),
      is_home: z.boolean().optional(),
      note: z.string().optional(),
    })
    .safeParse(req.body);
  if (!body.success) return sendError(res, 400, 'VALIDATION', 'Invalid session', body.error.flatten());

  const v = await getVehicleForUser(body.data.vehicle_id, req.user!.id);
  if (!v) return sendError(res, 404, 'NOT_FOUND', 'Vehicle not found');
  const spec = effectiveSpec(v);

  const energy =
    body.data.energy_kwh ??
    Math.max(
      0,
      ((body.data.soc_end - body.data.soc_start) / 100) * spec.usableKwh,
    );

  let rate = body.data.rate_paise_per_kwh;
  if (!rate && body.data.station_id) {
    const tariff = await prisma.tariff.findFirst({ where: { stationId: body.data.station_id } });
    rate = tariff?.energyRatePaise;
  }
  if (!rate) rate = body.data.is_home ? 800 : 1800;

  const cost = estimateChargeCost({
    energyKwh: energy,
    energyRatePaisePerKwh: rate,
    sessionFeePaise: body.data.session_fee_paise ?? 0,
    lossFactor: body.data.is_home ? 1.08 : 1,
  });

  const session = await prisma.chargingSession.create({
    data: {
      userId: req.user!.id,
      vehicleId: v.id,
      stationId: body.data.station_id ?? null,
      startedAt: body.data.started_at ? new Date(body.data.started_at) : new Date(),
      endedAt: body.data.ended_at ? new Date(body.data.ended_at) : new Date(),
      status: 'completed',
      energyKwh: energy,
      maxPowerKw: body.data.max_power_kw,
      socStart: body.data.soc_start,
      socEnd: body.data.soc_end,
      costPaiseEstimated: cost.totalCostPaise,
      costPaiseActual: cost.totalCostPaise,
      source: 'manual',
      note: body.data.note,
    },
  });

  await prisma.costRecord.create({
    data: {
      userId: req.user!.id,
      vehicleId: v.id,
      chargingSessionId: session.id,
      category: body.data.is_home ? 'home' : 'public_charge',
      amountPaise: cost.totalCostPaise,
      energyKwh: energy,
      recordedAt: session.endedAt ?? session.startedAt,
      source: 'manual',
    },
  });

  // Also log ending SOC as telemetry
  await prisma.telemetry.create({
    data: {
      vehicleId: v.id,
      observedAt: session.endedAt ?? new Date(),
      socPercent: body.data.soc_end,
      source: 'manual',
      createdBy: req.user!.id,
      confidence: 90,
    },
  });

  await createInAppNotification({
    userId: req.user!.id,
    type: 'charge_complete',
    title: 'Charge session logged',
    body: `Recorded ${Math.round(energy * 10) / 10} kWh · ₹${cost.totalCostInr} (manual — not live OEM)`,
    payload: { session_id: session.id },
  });

  if (body.data.soc_end < 20) {
    await createInAppNotification({
      userId: req.user!.id,
      type: 'low_battery',
      title: 'Still low after charge',
      body: `Ending SOC ${body.data.soc_end}% is below 20%. Consider a longer session next time.`,
      payload: { vehicle_id: v.id, soc_percent: body.data.soc_end },
    });
  }

  res.status(201).json({
    id: session.id,
    energy_kwh: energy,
    cost: cost,
    data_label: 'manually_entered',
  });
});

router.post('/costs/estimate', requireAuth, async (req, res) => {
  const body = z
    .object({
      energy_kwh: z.number().positive(),
      rate_paise_per_kwh: z.number().int().positive(),
      session_fee_paise: z.number().int().min(0).optional(),
      loss_factor: z.number().positive().optional(),
      idle_minutes: z.number().min(0).optional(),
      idle_fee_paise_per_min: z.number().int().min(0).optional(),
    })
    .safeParse(req.body);
  if (!body.success) return sendError(res, 400, 'VALIDATION', 'Invalid', body.error.flatten());
  res.json(
    estimateChargeCost({
      energyKwh: body.data.energy_kwh,
      energyRatePaisePerKwh: body.data.rate_paise_per_kwh,
      sessionFeePaise: body.data.session_fee_paise,
      lossFactor: body.data.loss_factor,
      idleMinutes: body.data.idle_minutes,
      idleFeePaisePerMin: body.data.idle_fee_paise_per_min,
    }),
  );
});

router.get('/costs/summary', requireAuth, async (req, res) => {
  const vehicleId = req.query.vehicle_id as string | undefined;
  const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const records = await prisma.costRecord.findMany({
    where: {
      userId: req.user!.id,
      recordedAt: { gte: from },
      ...(vehicleId ? { vehicleId } : {}),
    },
  });
  const home = records.filter((r) => r.category === 'home');
  const pub = records.filter((r) => r.category === 'public_charge');
  const sum = (rows: typeof records) => ({
    amount_paise: rows.reduce((a, r) => a + r.amountPaise, 0),
    energy_kwh: rows.reduce((a, r) => a + (r.energyKwh ?? 0), 0),
    count: rows.length,
  });
  res.json({
    period: 'month',
    home: sum(home),
    public: sum(pub),
    total: sum(records),
    data_label: 'manually_entered',
  });
});

router.post('/home-chargers/estimate', requireAuth, async (req, res) => {
  const body = z
    .object({
      vehicle_id: z.string().uuid(),
      daily_km: z.number().positive(),
      target_soc: z.number().min(1).max(100),
      soc_start: z.number().min(0).max(100),
      power_kw: z.number().positive().default(3.3),
      rate_paise_per_kwh: z.number().int().positive().default(800),
    })
    .safeParse(req.body);
  if (!body.success) return sendError(res, 400, 'VALIDATION', 'Invalid', body.error.flatten());
  const v = await getVehicleForUser(body.data.vehicle_id, req.user!.id);
  if (!v) return sendError(res, 404, 'NOT_FOUND', 'Vehicle not found');
  const spec = effectiveSpec(v);
  const energyNeeded = Math.max(
    0,
    ((body.data.target_soc - body.data.soc_start) / 100) * spec.usableKwh,
  );
  const time = estimateChargeTime({
    socStart: body.data.soc_start,
    socTarget: body.data.target_soc,
    usableKwh: spec.usableKwh,
    chargerKw: body.data.power_kw,
    taperStartSoc: 100,
  });
  const cost = estimateChargeCost({
    energyKwh: energyNeeded,
    energyRatePaisePerKwh: body.data.rate_paise_per_kwh,
    lossFactor: 1.08,
  });
  const dailyEnergy = (spec.efficiencyWhPerKmCity / 1000) * body.data.daily_km * 1.08;
  const monthly = estimateChargeCost({
    energyKwh: dailyEnergy * 30,
    energyRatePaisePerKwh: body.data.rate_paise_per_kwh,
  });
  res.json({
    energy_kwh: cost.energyKwhDelivered,
    duration_min: time.durationMin,
    cost_paise: cost.totalCostPaise,
    monthly_cost_paise: monthly.totalCostPaise,
    losses_kwh_est: cost.energyKwhFromGrid - cost.energyKwhDelivered,
    data_label: 'estimated',
  });
});

// ── Trip planner (P2 strategies) ──────────────────────
router.post('/trips/plan', requireAuth, async (req, res) => {
  const body = z
    .object({
      vehicle_id: z.string().uuid(),
      origin: z.object({
        lat: z.number(),
        lng: z.number(),
        label: z.string().optional(),
      }),
      destination: z.object({
        lat: z.number(),
        lng: z.number(),
        label: z.string().optional(),
      }),
      soc_start_percent: z.number().min(0).max(100),
      target_soc_arrival_percent: z.number().min(0).max(100).default(20),
      cabin_ac: z.boolean().optional(),
      load_kg: z.number().min(0).optional(),
      strategy: z.enum(['fastest', 'lowest_cost', 'most_reliable']).default('fastest'),
      max_detour_km: z.number().positive().optional(),
    })
    .safeParse(req.body);
  if (!body.success) return sendError(res, 400, 'VALIDATION', 'Invalid trip', body.error.flatten());

  const v = await getVehicleForUser(body.data.vehicle_id, req.user!.id);
  if (!v) return sendError(res, 404, 'NOT_FOUND', 'Vehicle not found');
  const spec = effectiveSpec(v);
  const strategy = body.data.strategy as TripStrategy;
  const maxDetour = body.data.max_detour_km ?? 80;

  const straight = haversineKm(body.data.origin, body.data.destination);
  // Heuristic road factor ~1.25 when Maps Directions unavailable
  const distanceKm = straight * 1.25;
  const trip = estimateTripEnergy({
    distanceKm,
    socStartPercent: body.data.soc_start_percent,
    targetSocArrivalPercent: body.data.target_soc_arrival_percent,
    usableKwh: spec.usableKwh,
    efficiencyWhPerKm: spec.efficiencyWhPerKmHighway,
    cabinAcWhPerKm: body.data.cabin_ac === false ? 0 : 15,
    loadKg: body.data.load_kg,
  });

  const mid = {
    lat: (body.data.origin.lat + body.data.destination.lat) / 2,
    lng: (body.data.origin.lng + body.data.destination.lng) / 2,
  };

  const stations = await prisma.station.findMany({
    where: {
      deletedAt: null,
      status: 'active',
      OR: [{ quarantineUntil: null }, { quarantineUntil: { lt: new Date() } }],
    },
    include: { connectors: true, tariffs: true },
  });

  const byId = new Map(stations.map((s) => [s.id, s]));
  const stationCandidates: StationCandidate[] = [];
  for (const s of stations) {
    const dc = s.connectors
      .filter((c) => c.currentType === 'dc')
      .sort((a, b) => b.powerKw - a.powerKw)[0];
    const best = dc ?? [...s.connectors].sort((a, b) => b.powerKw - a.powerKw)[0];
    if (!best) continue;
    const detourKm = haversineKm(mid, { lat: s.lat, lng: s.lng });
    if (detourKm > maxDetour) continue;
    stationCandidates.push({
      id: s.id,
      name: s.name,
      detourKm,
      maxPowerKw: best.powerKw,
      energyRatePaise: s.tariffs[0]?.energyRatePaise ?? 1800,
      reliabilityScore: s.reliabilityScore,
      reliabilityConfidence: s.reliabilityConfidence ?? 0,
      isDemo: s.isDemo,
    });
  }

  const ranked = selectStopsForStrategy(stationCandidates, strategy, 3);
  const comparison = strategyComparison(stationCandidates);

  const stops: Array<Record<string, unknown>> = [];
  if (trip.needsCharge || distanceKm > 120) {
    let seq = 1;
    let soc = body.data.soc_start_percent;
    const pickCount = trip.needsCharge ? Math.min(2, ranked.length) : Math.min(1, ranked.length);
    for (const c of ranked.slice(0, pickCount)) {
      const st = byId.get(c.id)!;
      const leg =
        haversineKm(seq === 1 ? body.data.origin : mid, { lat: st.lat, lng: st.lng }) * 1.2;
      const legTrip = estimateTripEnergy({
        distanceKm: leg,
        socStartPercent: soc,
        targetSocArrivalPercent: 15,
        usableKwh: spec.usableKwh,
        efficiencyWhPerKm: spec.efficiencyWhPerKmHighway,
        cabinAcWhPerKm: 15,
      });
      const arrive = legTrip.destSocPercent;
      const depart = Math.min(80, Math.max(arrive + 30, 60));
      const chargeKwh = ((depart - arrive) / 100) * spec.usableKwh;
      const dwell = estimateChargeTime({
        socStart: arrive,
        socTarget: depart,
        usableKwh: spec.usableKwh,
        chargerKw: c.maxPowerKw,
      });
      const cost = estimateChargeCost({
        energyKwh: Math.max(0, chargeKwh),
        energyRatePaisePerKwh: c.energyRatePaise,
      });
      stops.push({
        seq,
        kind: 'charge',
        station_id: c.id,
        name: c.name,
        is_demo: c.isDemo,
        soc_arrive: Math.round(arrive * 10) / 10,
        soc_depart: depart,
        charge_kwh_est: Math.round(Math.max(0, chargeKwh) * 1000) / 1000,
        dwell_min: dwell.durationMin,
        cost_paise_est: cost.totalCostPaise,
        reliability: reliabilitySummary(st),
        strategy_score: c.strategy_score,
        rank_reason: c.rank_reason,
        last_verified_at: st.lastVerifiedAt?.toISOString() ?? null,
      });
      soc = depart;
      seq += 1;
    }
  }

  // Alternatives: top picks under other strategies (not already in stops)
  const stopIds = new Set(stops.map((s) => s.station_id as string));
  const alternatives = (['fastest', 'lowest_cost', 'most_reliable'] as TripStrategy[])
    .filter((s) => s !== strategy)
    .map((s) => {
      const pick = comparison[s];
      if (!pick || stopIds.has(pick.id)) return null;
      return {
        strategy: s,
        station_id: pick.id,
        name: pick.name,
        rank_reason: pick.rank_reason,
        strategy_score: pick.strategy_score,
        reliability_score: pick.reliabilityScore,
        energy_rate_paise: pick.energyRatePaise,
        max_power_kw: pick.maxPowerKw,
        is_demo: pick.isDemo,
      };
    })
    .filter(Boolean);

  // Duration heuristic: base drive + charge dwell; fastest gets slight credit for power
  const dwellTotal = stops.reduce((a, s) => a + (Number(s.dwell_min) || 0), 0);
  const durationMin = Math.round(distanceKm / (strategy === 'fastest' ? 65 : 55) * 60 + dwellTotal);

  const plan = await prisma.routePlan.create({
    data: {
      userId: req.user!.id,
      vehicleId: v.id,
      originLat: body.data.origin.lat,
      originLng: body.data.origin.lng,
      originLabel: body.data.origin.label,
      destinationLat: body.data.destination.lat,
      destinationLng: body.data.destination.lng,
      destinationLabel: body.data.destination.label,
      socStartPercent: body.data.soc_start_percent,
      targetSocArrival: body.data.target_soc_arrival_percent,
      distanceKm,
      energyKwhEst: trip.energyKwhEst,
      destSocPercent: trip.destSocPercent,
      confidence: trip.confidence,
      safetyReservePercent: trip.safetyReservePercent,
      provider: 'heuristic',
      strategy,
      status: 'draft',
      stopsJson: JSON.stringify(stops),
      alternativesJson: JSON.stringify(alternatives),
      disclaimer: trip.disclaimer,
    },
  });

  res.json({
    route_plan_id: plan.id,
    distance_km: Math.round(distanceKm * 10) / 10,
    duration_min: durationMin,
    energy_kwh_est: trip.energyKwhEst,
    dest_soc_percent: trip.destSocPercent,
    confidence: trip.confidence,
    safety_reserve_percent: trip.safetyReservePercent,
    disclaimer: trip.disclaimer,
    stops,
    alternatives,
    strategy_comparison: {
      fastest: comparison.fastest
        ? { station_id: comparison.fastest.id, name: comparison.fastest.name }
        : null,
      lowest_cost: comparison.lowest_cost
        ? { station_id: comparison.lowest_cost.id, name: comparison.lowest_cost.name }
        : null,
      most_reliable: comparison.most_reliable
        ? { station_id: comparison.most_reliable.id, name: comparison.most_reliable.name }
        : null,
    },
    provider: 'heuristic',
    provider_banner:
      'Maps Directions API key not configured — using haversine × 1.25 road factor. Reliability is crowdsource, not operator telemetry.',
    data_label: 'estimated',
    strategy,
  });
});

router.get('/trips/plans', requireAuth, async (req, res) => {
  const plans = await prisma.routePlan.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  res.json({
    data: plans.map((p) => ({
      id: p.id,
      origin_label: p.originLabel,
      destination_label: p.destinationLabel,
      distance_km: p.distanceKm,
      energy_kwh_est: p.energyKwhEst,
      dest_soc_percent: p.destSocPercent,
      confidence: p.confidence,
      provider: p.provider,
      data_label: 'estimated',
      created_at: p.createdAt,
    })),
  });
});
