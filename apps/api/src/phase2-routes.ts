import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  estimateRangeWithHistory,
  type EfficiencySample,
} from '@evsaathi/shared';
import { prisma } from './prisma';
import { requireAuth } from './auth';
import { sendError } from './errors';
import {
  checkReportRateLimit,
  createInAppNotification,
  findAlternatives,
  parseJson,
  parseMediaUrls,
  recomputeAllReliability,
  recomputeStationReliability,
  reliabilitySummary,
} from './reliability-service';
import { effectiveSpec, getVehicleForUser } from './vehicle-helpers';

export const phase2Router = Router();

const REPORT_CATEGORIES = [
  'working',
  'session_ok',
  'charger_dead',
  'started_failed',
  'payment_failed',
  'power_low',
  'connector_damaged',
  'inaccessible',
  'queue',
  'safety_cleanliness',
  'other',
] as const;

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'moderator')) {
    return sendError(res, 403, 'FORBIDDEN', 'Admin or moderator role required');
  }
  return next();
}

// ── Reliability ───────────────────────────────────────
phase2Router.get('/stations/:id/reliability', async (req, res) => {
  const station = await prisma.station.findFirst({
    where: { id: req.params.id, deletedAt: null },
  });
  if (!station) return sendError(res, 404, 'NOT_FOUND', 'Station not found');

  let snap = await prisma.stationReliability.findUnique({
    where: { stationId: station.id },
  });
  if (!snap || !station.reliabilityUpdatedAt) {
    const computed = await recomputeStationReliability(station.id);
    if (!computed) return sendError(res, 404, 'NOT_FOUND', 'Station not found');
    return res.json({
      ...computed,
      last_verified_at: station.lastVerifiedAt?.toISOString() ?? null,
      quarantined:
        station.quarantineUntil != null && station.quarantineUntil > new Date(),
      data_label: 'estimated',
    });
  }

  res.json({
    score: snap.score,
    confidence: snap.confidence,
    display: snap.display,
    last_verified_at: station.lastVerifiedAt?.toISOString() ?? null,
    components: parseJson(snap.componentsJson, {}),
    sample_sizes: parseJson(snap.sampleSizesJson, {}),
    weights: parseJson(snap.weightsJson, {}),
    computed_at: snap.computedAt,
    quarantined:
      station.quarantineUntil != null && station.quarantineUntil > new Date(),
    provenance_note:
      'Crowdsource reliability — not operator live telemetry. Score blends owner reports, verification age, and optional operator feed (capped).',
    formula_version: 'p2-v1',
    data_label: 'estimated',
  });
});

phase2Router.get('/stations/:id/alternatives', async (req, res) => {
  const lat = req.query.lat != null ? parseFloat(String(req.query.lat)) : undefined;
  const lng = req.query.lng != null ? parseFloat(String(req.query.lng)) : undefined;
  const limit = req.query.limit != null ? parseInt(String(req.query.limit), 10) : 5;
  const alts = await findAlternatives({
    stationId: req.params.id,
    lat: Number.isFinite(lat) ? lat : undefined,
    lng: Number.isFinite(lng) ? lng : undefined,
    limit: Number.isFinite(limit) ? limit : 5,
  });
  if (!alts) return sendError(res, 404, 'NOT_FOUND', 'Station not found');
  res.json({
    data: alts,
    note: 'Compatible nearby substitutes — ranked by crowdsource reliability then distance. Not live availability.',
    data_label: 'estimated',
  });
});

// ── Owner reports ─────────────────────────────────────
phase2Router.post('/stations/:id/failure-reports', requireAuth, async (req, res) => {
  const station = await prisma.station.findFirst({
    where: { id: req.params.id, deletedAt: null },
  });
  if (!station) return sendError(res, 404, 'NOT_FOUND', 'Station not found');

  const body = z
    .object({
      connector_id: z.string().uuid().optional().nullable(),
      category: z.enum(REPORT_CATEGORIES),
      severity: z.enum(['low', 'medium', 'high']).default('medium'),
      description: z.string().max(2000).optional(),
      media_urls: z.array(z.string().url().or(z.string().startsWith('data:'))).max(5).optional(),
    })
    .safeParse(req.body);
  if (!body.success) return sendError(res, 400, 'VALIDATION', 'Invalid report', body.error.flatten());

  const limit = await checkReportRateLimit(req.user!.id, station.id);
  if (!limit.ok) return sendError(res, 429, 'RATE_LIMITED', limit.error);

  const media = parseMediaUrls(body.data.media_urls ?? []);
  const report = await prisma.failureReport.create({
    data: {
      stationId: station.id,
      connectorId: body.data.connector_id ?? null,
      userId: req.user!.id,
      category: body.data.category,
      severity: body.data.severity,
      description: body.data.description,
      mediaUrlsJson: JSON.stringify(media),
      status: 'open',
      sourceMetadataJson: JSON.stringify({
        app: 'evsaathi',
        phase: 2,
        anti_spam: 'rate_limited',
      }),
    },
  });

  // Trusted crowd verification bump on working reports
  if (body.data.category === 'working' || body.data.category === 'session_ok') {
    await prisma.station.update({
      where: { id: station.id },
      data: { lastVerifiedAt: new Date() },
    });
  }

  const reliability = await recomputeStationReliability(station.id);

  // Notify users with this station on a draft trip plan
  const plans = await prisma.routePlan.findMany({
    where: { status: 'draft' },
    take: 50,
    orderBy: { createdAt: 'desc' },
  });
  const failureCategories = new Set([
    'charger_dead',
    'started_failed',
    'payment_failed',
    'connector_damaged',
    'inaccessible',
  ]);
  if (failureCategories.has(body.data.category)) {
    for (const p of plans) {
      const stops = parseJson<Array<{ station_id?: string }>>(p.stopsJson, []);
      if (stops.some((s) => s.station_id === station.id) && p.userId !== req.user!.id) {
        await createInAppNotification({
          userId: p.userId,
          type: 'station_failure',
          title: 'Planned charger reported failed',
          body: `${station.name}: ${body.data.category.replace(/_/g, ' ')}. Consider alternatives.`,
          payload: { station_id: station.id, route_plan_id: p.id },
        });
      }
    }
  }

  res.status(201).json({
    id: report.id,
    status: report.status,
    category: report.category,
    reliability,
    note: 'Owner crowd report — not operator telemetry',
    data_label: 'manually_entered',
  });
});

phase2Router.get('/stations/:id/failure-reports', async (req, res) => {
  const station = await prisma.station.findFirst({
    where: { id: req.params.id, deletedAt: null },
  });
  if (!station) return sendError(res, 404, 'NOT_FOUND', 'Station not found');

  const rows = await prisma.failureReport.findMany({
    where: {
      stationId: station.id,
      status: { not: 'rejected' },
    },
    orderBy: { reportedAt: 'desc' },
    take: 30,
  });

  res.json({
    data: rows.map((r) => ({
      id: r.id,
      category: r.category,
      severity: r.severity,
      description: r.description,
      media_urls: parseJson(r.mediaUrlsJson, [] as string[]),
      status: r.status,
      reported_at: r.reportedAt,
      data_label: 'manually_entered',
    })),
    note: 'Crowdsource owner reports — not live operator status',
  });
});

phase2Router.post('/stations/:id/reviews', requireAuth, async (req, res) => {
  const body = z
    .object({
      rating: z.number().int().min(1).max(5),
      body: z.string().max(2000).optional(),
    })
    .safeParse(req.body);
  if (!body.success) return sendError(res, 400, 'VALIDATION', 'Invalid review', body.error.flatten());

  const station = await prisma.station.findFirst({
    where: { id: req.params.id, deletedAt: null },
  });
  if (!station) return sendError(res, 404, 'NOT_FOUND', 'Station not found');

  const review = await prisma.stationReview.upsert({
    where: {
      stationId_userId: { stationId: station.id, userId: req.user!.id },
    },
    create: {
      stationId: station.id,
      userId: req.user!.id,
      rating: body.data.rating,
      body: body.data.body,
    },
    update: {
      rating: body.data.rating,
      body: body.data.body,
    },
  });
  await recomputeStationReliability(station.id);
  res.status(201).json({ id: review.id, rating: review.rating, data_label: 'manually_entered' });
});

phase2Router.get('/stations/:id/reviews', async (req, res) => {
  const rows = await prisma.stationReview.findMany({
    where: { stationId: req.params.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  res.json({
    data: rows.map((r) => ({
      id: r.id,
      rating: r.rating,
      body: r.body,
      created_at: r.createdAt,
      data_label: 'manually_entered',
    })),
  });
});

// ── Session analytics ─────────────────────────────────
phase2Router.get('/sessions/:id/analytics', requireAuth, async (req, res) => {
  const session = await prisma.chargingSession.findFirst({
    where: { id: req.params.id, userId: req.user!.id },
    include: { station: true },
  });
  if (!session) return sendError(res, 404, 'NOT_FOUND', 'Session not found');

  const series = parseJson<Array<{ t: number; power_kw: number; soc?: number }>>(
    session.seriesJson,
    [],
  );

  const durationMin =
    session.endedAt && session.startedAt
      ? (session.endedAt.getTime() - session.startedAt.getTime()) / 60000
      : null;

  res.json({
    session_id: session.id,
    energy_kwh: session.energyKwh,
    max_power_kw: session.maxPowerKw,
    avg_power_kw:
      session.avgPowerKw ??
      (series.length
        ? series.reduce((a, p) => a + p.power_kw, 0) / series.length
        : null),
    duration_min: durationMin != null ? Math.round(durationMin * 10) / 10 : null,
    soc_start: session.socStart,
    soc_end: session.socEnd,
    cost_paise: session.costPaiseActual ?? session.costPaiseEstimated,
    station: session.station
      ? { id: session.station.id, name: session.station.name, is_demo: session.station.isDemo }
      : null,
    power_curve: series,
    data_label: series.length ? 'manually_entered' : 'estimated',
    note: series.length
      ? 'Power curve from dense manual log points — not live operator telemetry'
      : 'No dense series logged — summary metrics only',
  });
});

phase2Router.patch('/sessions/:id/series', requireAuth, async (req, res) => {
  const body = z
    .object({
      points: z
        .array(
          z.object({
            t: z.number().min(0),
            power_kw: z.number().min(0),
            soc: z.number().min(0).max(100).optional(),
          }),
        )
        .min(1)
        .max(500),
    })
    .safeParse(req.body);
  if (!body.success) return sendError(res, 400, 'VALIDATION', 'Invalid series', body.error.flatten());

  const session = await prisma.chargingSession.findFirst({
    where: { id: req.params.id, userId: req.user!.id },
  });
  if (!session) return sendError(res, 404, 'NOT_FOUND', 'Session not found');

  const avg =
    body.data.points.reduce((a, p) => a + p.power_kw, 0) / body.data.points.length;
  const max = Math.max(...body.data.points.map((p) => p.power_kw));

  const updated = await prisma.chargingSession.update({
    where: { id: session.id },
    data: {
      seriesJson: JSON.stringify(body.data.points),
      avgPowerKw: Math.round(avg * 100) / 100,
      maxPowerKw: max,
    },
  });

  res.json({
    id: updated.id,
    points: body.data.points.length,
    avg_power_kw: updated.avgPowerKw,
    max_power_kw: updated.maxPowerKw,
    data_label: 'manually_entered',
  });
});

// ── History-weighted range ────────────────────────────
phase2Router.post('/vehicles/:id/range/advanced', requireAuth, async (req, res) => {
  const v = await getVehicleForUser(req.params.id, req.user!.id);
  if (!v) return sendError(res, 404, 'NOT_FOUND', 'Vehicle not found');
  const body = z
    .object({
      soc_percent: z.number().min(0).max(100),
      safety_reserve_percent: z.number().min(0).max(30).optional(),
    })
    .safeParse(req.body);
  if (!body.success) return sendError(res, 400, 'VALIDATION', 'Invalid', body.error.flatten());

  const spec = effectiveSpec(v);
  const samples = await buildEfficiencySamples(v.id, spec.usableKwh);
  const result = estimateRangeWithHistory({
    socPercent: body.data.soc_percent,
    usableKwh: spec.usableKwh,
    catalogWhPerKm: spec.efficiencyWhPerKmHighway,
    samples,
    safetyReservePercent: body.data.safety_reserve_percent,
  });

  res.json({
    ...result,
    usable_note: spec.usableNote,
    model: 'history_weighted_p2',
  });
});

async function buildEfficiencySamples(
  vehicleId: string,
  usableKwh: number,
): Promise<EfficiencySample[]> {
  const telemetry = await prisma.telemetry.findMany({
    where: { vehicleId, odometerKm: { not: null } },
    orderBy: { observedAt: 'asc' },
    take: 100,
  });
  const samples: EfficiencySample[] = [];
  for (let i = 1; i < telemetry.length; i++) {
    const a = telemetry[i - 1];
    const b = telemetry[i];
    const dist = (b.odometerKm ?? 0) - (a.odometerKm ?? 0);
    const socDrop = (a.socPercent - b.socPercent) / 100;
    if (dist < 5 || socDrop <= 0) continue;
    const energy = socDrop * usableKwh;
    const whPerKm = (energy / dist) * 1000;
    const ageDays = (Date.now() - b.observedAt.getTime()) / (24 * 60 * 60 * 1000);
    samples.push({ whPerKm, distanceKm: dist, ageDays });
  }
  return samples;
}

// ── Notifications ─────────────────────────────────────
phase2Router.get('/notifications', requireAuth, async (req, res) => {
  const rows = await prisma.notification.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  const fcmConfigured = Boolean(process.env.FCM_SERVER_KEY);
  res.json({
    data: rows.map((n) => ({
      id: n.id,
      channel: n.channel,
      type: n.type,
      title: n.title,
      body: n.body,
      payload: parseJson(n.payloadJson, {}),
      status: n.status,
      created_at: n.createdAt,
      read_at: n.readAt,
    })),
    delivery: fcmConfigured
      ? { mode: 'fcm_and_inbox', note: 'FCM_SERVER_KEY present — push attempted when tokens registered' }
      : {
          mode: 'inapp_inbox_only',
          note: 'FCM keys not configured — in-app inbox only (not push)',
        },
  });
});

phase2Router.post('/notifications/:id/read', requireAuth, async (req, res) => {
  const n = await prisma.notification.findFirst({
    where: { id: req.params.id, userId: req.user!.id },
  });
  if (!n) return sendError(res, 404, 'NOT_FOUND', 'Notification not found');
  const updated = await prisma.notification.update({
    where: { id: n.id },
    data: { status: 'read', readAt: new Date() },
  });
  res.json({ id: updated.id, status: updated.status, read_at: updated.readAt });
});

phase2Router.post('/notifications/read-all', requireAuth, async (req, res) => {
  await prisma.notification.updateMany({
    where: { userId: req.user!.id, status: { not: 'read' } },
    data: { status: 'read', readAt: new Date() },
  });
  res.json({ ok: true });
});

phase2Router.put('/me/push-tokens', requireAuth, async (req, res) => {
  const body = z
    .object({
      token: z.string().min(8),
      platform: z.enum(['android', 'ios', 'web']),
    })
    .safeParse(req.body);
  if (!body.success) return sendError(res, 400, 'VALIDATION', 'Invalid token', body.error.flatten());

  const row = await prisma.pushToken.upsert({
    where: {
      userId_token: { userId: req.user!.id, token: body.data.token },
    },
    create: {
      userId: req.user!.id,
      token: body.data.token,
      platform: body.data.platform,
    },
    update: { platform: body.data.platform },
  });

  res.json({
    id: row.id,
    platform: row.platform,
    fcm_configured: Boolean(process.env.FCM_SERVER_KEY),
    note: process.env.FCM_SERVER_KEY
      ? 'Token stored — FCM push enabled'
      : 'Token stored — FCM keys missing; notifications stay in-app inbox',
  });
});

phase2Router.post('/notifications/demo', requireAuth, async (req, res) => {
  const body = z
    .object({
      type: z
        .enum([
          'low_battery',
          'insufficient_range',
          'charge_complete',
          'station_failure',
          'unusual_consumption',
        ])
        .default('low_battery'),
    })
    .safeParse(req.body);
  if (!body.success) return sendError(res, 400, 'VALIDATION', 'Invalid', body.error.flatten());

  const titles: Record<string, { title: string; body: string }> = {
    low_battery: {
      title: 'Low battery',
      body: 'SOC is low on your active vehicle (manual entry). Plan a charge soon.',
    },
    insufficient_range: {
      title: 'Insufficient range for trip',
      body: 'Estimated range below trip distance — add a charge stop.',
    },
    charge_complete: {
      title: 'Charge session logged',
      body: 'Your manual charge session was recorded.',
    },
    station_failure: {
      title: 'Station issue on route',
      body: 'A planned charger has an owner failure report. Check alternatives.',
    },
    unusual_consumption: {
      title: 'Unusual consumption',
      body: 'Recent kWh/km is higher than your history blend — driving or weather may differ.',
    },
  };
  const copy = titles[body.data.type];
  const n = await createInAppNotification({
    userId: req.user!.id,
    type: body.data.type,
    title: copy.title,
    body: copy.body,
    payload: { demo: true },
  });
  res.status(201).json({
    id: n.id,
    channel: n.channel,
    delivery: process.env.FCM_SERVER_KEY ? 'fcm_and_inbox' : 'inapp_inbox_only',
  });
});

// ── Trip recalculate ──────────────────────────────────
phase2Router.post('/trips/plans/:id/recalculate', requireAuth, async (req, res) => {
  const plan = await prisma.routePlan.findFirst({
    where: { id: req.params.id, userId: req.user!.id },
  });
  if (!plan) return sendError(res, 404, 'NOT_FOUND', 'Plan not found');

  const stops = parseJson<Array<{ station_id?: string; name?: string }>>(plan.stopsJson, []);
  const failedIds: string[] = [];
  for (const s of stops) {
    if (!s.station_id) continue;
    const open = await prisma.failureReport.count({
      where: {
        stationId: s.station_id,
        status: { in: ['open', 'confirmed'] },
        category: {
          in: [
            'charger_dead',
            'started_failed',
            'payment_failed',
            'connector_damaged',
            'inaccessible',
          ],
        },
        reportedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
    });
    if (open > 0) failedIds.push(s.station_id);
  }

  const newStops = [];
  const alternatives = [];
  for (const s of stops) {
    if (s.station_id && failedIds.includes(s.station_id)) {
      const alts = await findAlternatives({ stationId: s.station_id, limit: 3 });
      if (alts?.[0]) {
        alternatives.push({
          replaced_station_id: s.station_id,
          replaced_name: s.name,
          alternative: alts[0],
        });
        newStops.push({
          ...s,
          station_id: alts[0].id,
          name: alts[0].name,
          replaced_due_to_failure: true,
          reliability: alts[0].reliability,
        });
      } else {
        newStops.push({ ...s, failure_flag: true });
      }
    } else {
      newStops.push(s);
    }
  }

  const updated = await prisma.routePlan.update({
    where: { id: plan.id },
    data: {
      stopsJson: JSON.stringify(newStops),
      alternativesJson: JSON.stringify(alternatives),
      status: 'recalculated',
    },
  });

  res.json({
    route_plan_id: updated.id,
    failed_station_ids: failedIds,
    stops: newStops,
    alternatives,
    disclaimer: plan.disclaimer,
    note: failedIds.length
      ? 'Recalculated after failure reports on planned stops'
      : 'No open failure reports on planned stops',
    data_label: 'estimated',
  });
});

// ── Admin triage ──────────────────────────────────────
phase2Router.get('/admin/failure-reports', requireAuth, requireAdmin, async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const rows = await prisma.failureReport.findMany({
    where: status ? { status } : undefined,
    include: { station: true, user: true },
    orderBy: { reportedAt: 'desc' },
    take: 100,
  });
  res.json({
    data: rows.map((r) => ({
      id: r.id,
      category: r.category,
      severity: r.severity,
      status: r.status,
      description: r.description,
      reported_at: r.reportedAt,
      station: {
        id: r.station.id,
        name: r.station.name,
        reliability_score: r.station.reliabilityScore,
        quarantined:
          r.station.quarantineUntil != null && r.station.quarantineUntil > new Date(),
      },
      user: { id: r.user.id, phone_e164: r.user.phoneE164, role: r.user.role },
      media_urls: parseJson(r.mediaUrlsJson, [] as string[]),
    })),
  });
});

phase2Router.patch('/admin/failure-reports/:id', requireAuth, requireAdmin, async (req, res) => {
  const body = z
    .object({
      status: z.enum(['open', 'confirmed', 'resolved', 'rejected']),
      moderation_notes: z.string().max(2000).optional(),
      quarantine_days: z.number().int().min(0).max(90).optional(),
    })
    .safeParse(req.body);
  if (!body.success) return sendError(res, 400, 'VALIDATION', 'Invalid', body.error.flatten());

  const report = await prisma.failureReport.findUnique({ where: { id: req.params.id } });
  if (!report) return sendError(res, 404, 'NOT_FOUND', 'Report not found');

  const updated = await prisma.failureReport.update({
    where: { id: report.id },
    data: {
      status: body.data.status,
      moderationNotes: body.data.moderation_notes,
    },
  });

  if (body.data.quarantine_days && body.data.quarantine_days > 0) {
    await prisma.station.update({
      where: { id: report.stationId },
      data: {
        quarantineUntil: new Date(
          Date.now() + body.data.quarantine_days * 24 * 60 * 60 * 1000,
        ),
        quarantineReason: `Admin quarantine after report ${report.id}`,
      },
    });
  }
  if (body.data.status === 'resolved' || body.data.status === 'rejected') {
    // clear quarantine optionally when resolving spam
    if (body.data.status === 'rejected') {
      await prisma.station.update({
        where: { id: report.stationId },
        data: { quarantineUntil: null, quarantineReason: null },
      });
    }
  }

  await recomputeStationReliability(report.stationId);
  res.json({
    id: updated.id,
    status: updated.status,
    moderation_notes: updated.moderationNotes,
  });
});

phase2Router.get('/admin/reliability/jobs', requireAuth, requireAdmin, async (_req, res) => {
  const jobs = await prisma.reliabilityJob.findMany({
    orderBy: { startedAt: 'desc' },
    take: 20,
  });
  res.json({ data: jobs });
});

phase2Router.post('/admin/reliability/recompute', requireAuth, requireAdmin, async (_req, res) => {
  const result = await recomputeAllReliability();
  res.json(result);
});

phase2Router.get('/admin/stations/reliability', requireAuth, requireAdmin, async (_req, res) => {
  const stations = await prisma.station.findMany({
    where: { deletedAt: null },
    orderBy: { reliabilityScore: 'asc' },
  });
  res.json({
    data: stations.map((s) => ({
      id: s.id,
      name: s.name,
      ...reliabilitySummary(s),
      quarantine_until: s.quarantineUntil,
      quarantine_reason: s.quarantineReason,
      is_demo: s.isDemo,
    })),
  });
});

/** Minimal HTML triage UI for admins */
phase2Router.get('/admin/triage', requireAuth, requireAdmin, async (_req, res) => {
  const reports = await prisma.failureReport.findMany({
    where: { status: 'open' },
    include: { station: true },
    orderBy: { reportedAt: 'desc' },
    take: 50,
  });
  const rows = reports
    .map(
      (r) =>
        `<tr><td>${r.id.slice(0, 8)}</td><td>${escapeHtml(r.station.name)}</td><td>${r.category}</td><td>${r.severity}</td><td>${r.reportedAt.toISOString()}</td><td>${r.station.reliabilityScore ?? '—'}</td></tr>`,
    )
    .join('');
  res.type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"/><title>EVSaathi Admin Triage</title>
<style>
body{font-family:ui-sans-serif,system-ui;background:#0b1220;color:#e8eef7;padding:24px}
h1{color:#2ee6a6} table{border-collapse:collapse;width:100%} td,th{border:1px solid #243044;padding:8px;font-size:13px}
.note{color:#f5b942;margin:12px 0}
</style></head><body>
<h1>EVSaathi · Failure triage</h1>
<p class="note">Crowdsource reports — not operator live telemetry. Use PATCH /v1/admin/failure-reports/:id to moderate.</p>
<table><thead><tr><th>ID</th><th>Station</th><th>Category</th><th>Severity</th><th>Reported</th><th>Score</th></tr></thead>
<tbody>${rows || '<tr><td colspan="6">No open reports</td></tr>'}</tbody></table>
</body></html>`);
});

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

export { buildEfficiencySamples };
