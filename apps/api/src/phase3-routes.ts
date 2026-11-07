import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  computeAdvancedAnalytics,
  freshnessAgeLabel,
  sourceToDataLabel,
} from '@evsaathi/shared';
import { prisma } from './prisma';
import { requireAuth } from './auth';
import { sendError } from './errors';
import { runAiAssistant } from './ai-assistant';
import {
  callOperatorFetchStations,
  callVehicleAdapterPull,
  catalogAdapters,
  ensureAdapterHealthSeeded,
  forceOpenCircuit,
  getOperatorAdapter,
  resetCircuit,
} from './adapters/registry';
import { DEMO_OEM_ADAPTER_ID } from './adapters/demo-oem';
import { DEMO_OPERATOR_ADAPTER_ID } from './adapters/demo-operator';
import {
  effectiveSpec,
  getVehicleForUser,
  parseJson,
} from './vehicle-helpers';

export const phase3Router = Router();

const CONSENT_POLICY = 'evsaathi-integrations-v1';

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'moderator')) {
    return sendError(res, 403, 'FORBIDDEN', 'Admin or moderator role required');
  }
  return next();
}

// ── Adapter catalog (P3-M01) ──────────────────────────
phase3Router.get('/integrations/adapters', async (_req, res) => {
  await ensureAdapterHealthSeeded();
  res.json({
    ...catalogAdapters(),
    phase: 3,
    note: 'Stub/demo adapters only until authorized partnerships. Never claim LIVE without a real feed.',
  });
});

// ── Consent UX (P3-M02) ───────────────────────────────
phase3Router.get('/integrations/consents', requireAuth, async (req, res) => {
  const rows = await prisma.consentRecord.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: 'desc' },
  });
  res.json({
    policy_version: CONSENT_POLICY,
    data: rows.map((r) => ({
      id: r.id,
      adapter_id: r.adapterId,
      vehicle_id: r.vehicleId,
      purpose: r.purpose,
      policy_version: r.policyVersion,
      granted: r.granted,
      granted_at: r.grantedAt,
      revoked_at: r.revokedAt,
      metadata: parseJson(r.metadataJson, {}),
    })),
  });
});

phase3Router.post('/integrations/consents', requireAuth, async (req, res) => {
  const body = z
    .object({
      adapter_id: z.string().min(2),
      vehicle_id: z.string().uuid().optional(),
      purpose: z.enum([
        'oem_readonly_telemetry',
        'operator_directory',
        'operator_session_sync',
      ]),
      granted: z.boolean(),
    })
    .safeParse(req.body);
  if (!body.success) return sendError(res, 400, 'VALIDATION', 'Invalid consent', body.error.flatten());

  if (body.data.vehicle_id) {
    const v = await getVehicleForUser(body.data.vehicle_id, req.user!.id);
    if (!v) return sendError(res, 404, 'NOT_FOUND', 'Vehicle not found');
  }

  const known =
    catalogAdapters().vehicle.some((a) => a.id === body.data.adapter_id) ||
    catalogAdapters().operator.some((a) => a.id === body.data.adapter_id);
  if (!known) return sendError(res, 400, 'VALIDATION', 'Unknown adapter_id');

  const record = await prisma.consentRecord.create({
    data: {
      userId: req.user!.id,
      vehicleId: body.data.vehicle_id,
      adapterId: body.data.adapter_id,
      purpose: body.data.purpose,
      policyVersion: CONSENT_POLICY,
      granted: body.data.granted,
      grantedAt: body.data.granted ? new Date() : null,
      revokedAt: body.data.granted ? null : new Date(),
      metadataJson: JSON.stringify({
        ui: 'integrations_consent',
        phase: 3,
        demo_only: true,
      }),
    },
  });

  if (body.data.vehicle_id && body.data.purpose === 'oem_readonly_telemetry') {
    await prisma.vehicle.update({
      where: { id: body.data.vehicle_id },
      data: {
        oemLinkStatus: body.data.granted ? 'demo_linked' : 'none',
        oemAdapterId: body.data.granted ? body.data.adapter_id : null,
        telemetrySourcePreferred: body.data.granted ? 'oem' : 'manual',
      },
    });
  }
  if (body.data.vehicle_id && body.data.purpose.startsWith('operator_')) {
    await prisma.vehicle.update({
      where: { id: body.data.vehicle_id },
      data: {
        operatorAdapterId: body.data.granted ? body.data.adapter_id : null,
      },
    });
  }

  res.status(201).json({
    id: record.id,
    granted: record.granted,
    policy_version: record.policyVersion,
    adapter_id: record.adapterId,
    note: body.data.granted
      ? 'Consent recorded for DEMO/simulated adapter — still not a live OEM/operator feed'
      : 'Consent revoked — manual path remains available',
  });
});

phase3Router.post('/integrations/consents/:id/revoke', requireAuth, async (req, res) => {
  const row = await prisma.consentRecord.findFirst({
    where: { id: req.params.id, userId: req.user!.id },
  });
  if (!row) return sendError(res, 404, 'NOT_FOUND', 'Consent not found');
  const updated = await prisma.consentRecord.update({
    where: { id: row.id },
    data: { granted: false, revokedAt: new Date() },
  });
  if (row.vehicleId && row.purpose === 'oem_readonly_telemetry') {
    await prisma.vehicle.update({
      where: { id: row.vehicleId },
      data: {
        oemLinkStatus: 'none',
        oemAdapterId: null,
        telemetrySourcePreferred: 'manual',
      },
    });
  }
  res.json({ id: updated.id, granted: false, revoked_at: updated.revokedAt });
});

async function requireOemConsent(userId: string, vehicleId: string, adapterId: string) {
  return prisma.consentRecord.findFirst({
    where: {
      userId,
      vehicleId,
      adapterId,
      purpose: 'oem_readonly_telemetry',
      granted: true,
      revokedAt: null,
    },
    orderBy: { createdAt: 'desc' },
  });
}

// ── OEM pull (P3-M02 / M04 / M08) ─────────────────────
phase3Router.post('/vehicles/:id/integrations/oem/sync', requireAuth, async (req, res) => {
  const vehicle = await getVehicleForUser(req.params.id, req.user!.id);
  if (!vehicle) return sendError(res, 404, 'NOT_FOUND', 'Vehicle not found');

  const adapterId = vehicle.oemAdapterId || DEMO_OEM_ADAPTER_ID;
  const consent = await requireOemConsent(req.user!.id, vehicle.id, adapterId);
  if (!consent) {
    return sendError(
      res,
      403,
      'CONSENT_REQUIRED',
      'Grant OEM read-only consent before syncing the demo adapter',
    );
  }

  const result = await callVehicleAdapterPull(adapterId, vehicle.id);
  if (!result.ok) {
    return res.status(503).json({
      degraded: true,
      fallback: 'manual',
      reason: result.reason,
      data_label: 'manually_entered',
      note: 'Graceful degradation — enter SOC manually or retry later',
    });
  }

  const obs = result.data;
  if (!obs) {
    return res.status(503).json({
      degraded: true,
      fallback: 'manual',
      reason: 'Adapter returned empty observation',
      data_label: 'manually_entered',
    });
  }

  const row = await prisma.telemetry.create({
    data: {
      vehicleId: vehicle.id,
      observedAt: new Date(obs.observed_at),
      source: obs.source,
      socPercent: obs.soc_percent,
      rangeKmEst: obs.range_km ?? null,
      odometerKm: obs.odometer_km ?? null,
      lat: obs.location?.lat ?? null,
      lng: obs.location?.lng ?? null,
      confidence: Math.round((obs.source_metadata.confidence ?? 0.5) * 100),
      createdBy: req.user!.id,
    },
  });

  await prisma.vehicle.update({
    where: { id: vehicle.id },
    data: { oemLinkStatus: 'demo_linked', oemAdapterId: adapterId },
  });

  res.json({
    telemetry_id: row.id,
    observation: obs,
    freshness: freshnessAgeLabel(obs.observed_at),
    data_label: obs.data_label,
    mode: obs.source_metadata.mode,
    live_claim: false,
    note: obs.source_metadata.note,
  });
});

// ── Operator directory sync (P3-M03) ──────────────────
phase3Router.post('/integrations/operators/:adapterId/sync-catalog', requireAuth, async (req, res) => {
  const adapterId = req.params.adapterId || DEMO_OPERATOR_ADAPTER_ID;
  const consent = await prisma.consentRecord.findFirst({
    where: {
      userId: req.user!.id,
      adapterId,
      purpose: { in: ['operator_directory', 'operator_session_sync'] },
      granted: true,
      revokedAt: null,
    },
  });
  if (!consent) {
    return sendError(res, 403, 'CONSENT_REQUIRED', 'Grant operator adapter consent first');
  }

  const result = await callOperatorFetchStations(adapterId);
  if (!result.ok) {
    return res.status(503).json({
      degraded: true,
      fallback: 'manual',
      reason: result.reason,
      note: 'Seeded demo stations remain available in /stations',
    });
  }

  res.json({
    adapter_id: adapterId,
    stations: result.data,
    count: result.data.length,
    live_claim: false,
    note: 'Demo operator catalog — availability fields are null; not LIVE',
  });
});

// ── Live session intelligence when provided (P3-M05) ──
phase3Router.get('/vehicles/:id/integrations/sessions/live', requireAuth, async (req, res) => {
  const vehicle = await getVehicleForUser(req.params.id, req.user!.id);
  if (!vehicle) return sendError(res, 404, 'NOT_FOUND', 'Vehicle not found');

  const adapterId = vehicle.operatorAdapterId || DEMO_OPERATOR_ADAPTER_ID;
  const consent = await prisma.consentRecord.findFirst({
    where: {
      userId: req.user!.id,
      vehicleId: vehicle.id,
      adapterId,
      purpose: 'operator_session_sync',
      granted: true,
      revokedAt: null,
    },
  });

  if (!consent) {
    return res.json({
      available: false,
      reason: 'No operator session-sync consent — use manual/import session logging',
      fallback: 'manual',
      data_label: 'manually_entered',
    });
  }

  const adapter = getOperatorAdapter(adapterId);
  if (!adapter?.listDemoSessions) {
    return res.json({
      available: false,
      reason: 'Adapter does not provide session intelligence',
      fallback: 'manual',
      data_label: 'manually_entered',
    });
  }

  // Circuit / degradation path
  const health = await prisma.adapterHealth.findUnique({ where: { adapterId } });
  if (health?.circuitState === 'open') {
    return res.status(503).json({
      available: false,
      degraded: true,
      reason: 'Operator circuit open — falling back to manual sessions',
      fallback: 'manual',
      data_label: 'manually_entered',
    });
  }

  const sessions = await adapter.listDemoSessions(vehicle.id);
  const active = sessions[0] ?? null;
  if (!active) {
    return res.json({
      available: false,
      reason: 'Adapter provided no session payload',
      fallback: 'manual',
      data_label: 'manually_entered',
    });
  }

  res.json({
    available: true,
    session: active,
    freshness: freshnessAgeLabel(active.updated_at),
    data_label: 'recently_synchronized',
    live_claim: false,
    mode: active.provenance.mode,
    note: active.provenance.note,
  });
});

phase3Router.post('/vehicles/:id/integrations/sessions/import-demo', requireAuth, async (req, res) => {
  const vehicle = await getVehicleForUser(req.params.id, req.user!.id);
  if (!vehicle) return sendError(res, 404, 'NOT_FOUND', 'Vehicle not found');

  const live = await (async () => {
    const adapterId = vehicle.operatorAdapterId || DEMO_OPERATOR_ADAPTER_ID;
    const consent = await prisma.consentRecord.findFirst({
      where: {
        userId: req.user!.id,
        vehicleId: vehicle.id,
        adapterId,
        purpose: 'operator_session_sync',
        granted: true,
      },
    });
    if (!consent) return null;
    const adapter = getOperatorAdapter(adapterId);
    if (!adapter?.listDemoSessions) return null;
    const list = await adapter.listDemoSessions(vehicle.id);
    return list[0] ?? null;
  })();

  if (!live) {
    return sendError(
      res,
      400,
      'NO_SESSION_FEED',
      'No operator session intelligence available — log manually',
    );
  }

  const session = await prisma.chargingSession.create({
    data: {
      userId: req.user!.id,
      vehicleId: vehicle.id,
      startedAt: new Date(live.started_at),
      endedAt: live.status === 'completed' ? new Date(live.updated_at) : null,
      status: live.status === 'active' ? 'in_progress' : 'completed',
      energyKwh: live.energy_kwh,
      maxPowerKw: live.power_kw,
      avgPowerKw: live.power_kw,
      socStart: live.soc_percent != null ? Math.max(0, live.soc_percent - 20) : null,
      socEnd: live.soc_percent,
      costPaiseEstimated: live.cost_paise,
      source: 'operator_session',
      note: live.provenance.note ?? 'Imported from demo operator session adapter',
      seriesJson: JSON.stringify(live.series ?? []),
    },
  });

  res.status(201).json({
    id: session.id,
    source: session.source,
    data_label: 'recently_synchronized',
    live_claim: false,
    note: 'Session intelligence from DEMO adapter — not a live CDR',
  });
});

// ── Advanced analytics (P3-M07) ───────────────────────
phase3Router.get('/vehicles/:id/analytics/advanced', requireAuth, async (req, res) => {
  const vehicle = await getVehicleForUser(req.params.id, req.user!.id);
  if (!vehicle) return sendError(res, 404, 'NOT_FOUND', 'Vehicle not found');
  const spec = effectiveSpec(vehicle);

  const telemetry = await prisma.telemetry.findMany({
    where: { vehicleId: vehicle.id },
    orderBy: { observedAt: 'asc' },
    take: 200,
  });
  const sessions = await prisma.chargingSession.findMany({
    where: { vehicleId: vehicle.id },
    orderBy: { startedAt: 'desc' },
    take: 50,
  });

  const result = computeAdvancedAnalytics({
    usableKwh: spec.usableKwh,
    telemetry: telemetry.map((t) => ({
      observed_at: t.observedAt.toISOString(),
      soc_percent: t.socPercent,
      odometer_km: t.odometerKm,
      source: t.source,
      data_label: sourceToDataLabel(t.source),
    })),
    sessions: sessions.map((s) => {
      const series = parseJson<Array<{ power_kw?: number }>>(s.seriesJson, []);
      const peakFromSeries = series.reduce(
        (m, p) => Math.max(m, p.power_kw ?? 0),
        0,
      );
      return {
        energy_kwh: s.energyKwh,
        avg_power_kw: s.avgPowerKw,
        max_power_kw: s.maxPowerKw ?? (peakFromSeries || null),
        soc_start: s.socStart,
        soc_end: s.socEnd,
        source: s.source,
        started_at: s.startedAt.toISOString(),
      };
    }),
  });

  res.json({
    vehicle_id: vehicle.id,
    ...result,
    note: 'Advanced metrics only as rich as provided telemetry — never invents pack health',
  });
});

// ── AI assistant (P3-M06) ─────────────────────────────
phase3Router.post('/ai/assistant', requireAuth, async (req, res) => {
  const body = z
    .object({
      message: z.string().min(1).max(2000),
      vehicle_id: z.string().uuid().optional(),
      requested_tools: z.array(z.string()).max(10).optional(),
    })
    .safeParse(req.body);
  if (!body.success) return sendError(res, 400, 'VALIDATION', 'Invalid', body.error.flatten());

  if (body.data.vehicle_id) {
    const v = await getVehicleForUser(body.data.vehicle_id, req.user!.id);
    if (!v) return sendError(res, 404, 'NOT_FOUND', 'Vehicle not found');
  }

  const reply = await runAiAssistant({
    userId: req.user!.id,
    vehicleId: body.data.vehicle_id,
    message: body.data.message,
    requestedTools: body.data.requested_tools,
  });
  res.json(reply);
});

phase3Router.post('/ai/tools/check', requireAuth, async (req, res) => {
  const body = z.object({ tool: z.string().min(1) }).safeParse(req.body);
  if (!body.success) return sendError(res, 400, 'VALIDATION', 'Invalid');
  const { decideAiTool } = await import('@evsaathi/shared');
  const decision = decideAiTool(body.data.tool);
  await prisma.aiToolAudit.create({
    data: {
      userId: req.user!.id,
      tool: decision.tool,
      allowed: decision.allowed,
      reason: decision.reason,
      argsJson: JSON.stringify({ check_only: true }),
      resultJson: JSON.stringify(decision),
    },
  });
  res.json(decision);
});

// ── Admin: health, consent audit, circuit breakers (P3-M09) ──
phase3Router.get('/admin/integrations/health', requireAuth, requireAdmin, async (_req, res) => {
  await ensureAdapterHealthSeeded();
  const rows = await prisma.adapterHealth.findMany({ orderBy: { adapterId: 'asc' } });
  res.json({
    data: rows.map((r) => ({
      adapter_id: r.adapterId,
      kind: r.kind,
      display_name: r.displayName,
      mode: r.mode,
      status: r.status,
      circuit_state: r.circuitState,
      failure_count: r.failureCount,
      success_count: r.successCount,
      last_success_at: r.lastSuccessAt,
      last_failure_at: r.lastFailureAt,
      last_error: r.lastError,
      opened_at: r.openedAt,
      live_claim: false,
    })),
    note: 'Demo adapters report health for circuit drills — not production CPO/OEM SLAs',
  });
});

phase3Router.get('/admin/integrations/consents', requireAuth, requireAdmin, async (_req, res) => {
  const rows = await prisma.consentRecord.findMany({
    include: { user: true, vehicle: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  res.json({
    data: rows.map((r) => ({
      id: r.id,
      adapter_id: r.adapterId,
      purpose: r.purpose,
      granted: r.granted,
      policy_version: r.policyVersion,
      granted_at: r.grantedAt,
      revoked_at: r.revokedAt,
      user: { id: r.user.id, phone_e164: r.user.phoneE164 },
      vehicle_id: r.vehicleId,
    })),
  });
});

phase3Router.get('/admin/integrations/ai-audit', requireAuth, requireAdmin, async (_req, res) => {
  const rows = await prisma.aiToolAudit.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json({
    data: rows.map((r) => ({
      id: r.id,
      user_id: r.userId,
      tool: r.tool,
      allowed: r.allowed,
      reason: r.reason,
      created_at: r.createdAt,
    })),
  });
});

phase3Router.post(
  '/admin/integrations/circuit/:adapterId/open',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const body = z.object({ reason: z.string().max(200).default('admin_open') }).safeParse(req.body ?? {});
    const reason = body.success ? body.data.reason : 'admin_open';
    const row = await forceOpenCircuit(req.params.adapterId, reason);
    res.json({
      adapter_id: row.adapterId,
      circuit_state: row.circuitState,
      status: row.status,
      note: 'Circuit forced open — clients must degrade to manual',
    });
  },
);

phase3Router.post(
  '/admin/integrations/circuit/:adapterId/reset',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const row = await resetCircuit(req.params.adapterId);
    if (!row) return sendError(res, 404, 'NOT_FOUND', 'Adapter health row missing');
    res.json({
      adapter_id: row.adapterId,
      circuit_state: row.circuitState,
      status: row.status,
    });
  },
);

phase3Router.get('/admin/integrations', requireAuth, requireAdmin, async (_req, res) => {
  await ensureAdapterHealthSeeded();
  const health = await prisma.adapterHealth.findMany();
  const consents = await prisma.consentRecord.count();
  const denied = await prisma.aiToolAudit.count({ where: { allowed: false } });
  const allowed = await prisma.aiToolAudit.count({ where: { allowed: true } });
  res.type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"/><title>EVSaathi Integrations Admin</title>
<style>
body{font-family:system-ui;background:#0b1220;color:#e8eef7;padding:24px}
h1{color:#2dd4bf} table{border-collapse:collapse;width:100%;margin:16px 0}
td,th{border:1px solid #243044;padding:8px;text-align:left;font-size:13px}
.note{color:#94a3b8;font-size:13px} .warn{color:#f5b942}
</style></head><body>
<h1>EVSaathi · Phase 3 integrations</h1>
<p class="note">API health · consent audit · circuit breakers. Demo adapters never claim LIVE.</p>
<p>Consents: <b>${consents}</b> · AI tool audits allowed/denied: <b>${allowed}/${denied}</b></p>
<table><tr><th>Adapter</th><th>Mode</th><th>Status</th><th>Circuit</th><th>Failures</th><th>Last error</th></tr>
${health
  .map(
    (h) =>
      `<tr><td>${h.adapterId}</td><td>${h.mode}</td><td>${h.status}</td><td>${h.circuitState}</td><td>${h.failureCount}</td><td>${h.lastError ?? ''}</td></tr>`,
  )
  .join('')}
</table>
<p class="warn">POST /v1/admin/integrations/circuit/:id/open|reset to drill degradation.</p>
</body></html>`);
});
