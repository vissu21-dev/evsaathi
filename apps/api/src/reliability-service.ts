import {
  FAILURE_CATEGORIES,
  SUCCESS_CATEGORIES,
  computeReliabilityScore,
  haversineKm,
  type ReliabilityResult,
} from '@evsaathi/shared';
import { prisma } from './prisma';
import { parseJson } from './vehicle-helpers';

const DAY_MS = 24 * 60 * 60 * 1000;

export async function gatherReliabilityInputs(stationId: string) {
  const since30 = new Date(Date.now() - 30 * DAY_MS);
  const station = await prisma.station.findUnique({
    where: { id: stationId },
    include: {
      connectors: true,
      operator: true,
      reviews: true,
    },
  });
  if (!station) return null;

  const reports = await prisma.failureReport.findMany({
    where: { stationId, reportedAt: { gte: since30 } },
  });
  const observations = await prisma.availabilityObservation.findMany({
    where: { stationId, observedAt: { gte: since30 } },
  });
  const sessions = await prisma.chargingSession.findMany({
    where: {
      stationId,
      status: 'completed',
      startedAt: { gte: since30 },
      avgPowerKw: { not: null },
    },
  });

  const successes = reports.filter((r) => SUCCESS_CATEGORIES.has(r.category));
  const failures = reports.filter((r) => FAILURE_CATEGORIES.has(r.category));
  const queueReports = reports.filter((r) => r.category === 'queue');
  const openFailures = reports
    .filter(
      (r) =>
        FAILURE_CATEGORIES.has(r.category) &&
        (r.status === 'open' || r.status === 'confirmed'),
    )
    .map((r) => ({ severity: r.severity, category: r.category }));

  const attemptCount = successes.length + failures.length;
  const crowdSamples =
    reports.length + observations.length + Math.min(sessions.length, 5);

  let powerRatio: number | null = null;
  const advertised =
    station.connectors
      .filter((c) => c.currentType === 'dc')
      .sort((a, b) => b.powerKw - a.powerKw)[0]?.powerKw ??
    station.connectors[0]?.powerKw;
  if (advertised && sessions.length) {
    const avg =
      sessions.reduce((a, s) => a + (s.avgPowerKw ?? 0), 0) / sessions.length;
    powerRatio = avg / advertised;
  }

  let availabilityShare: number | null = null;
  if (observations.length) {
    const good = observations.filter((o) => o.status === 'available').length;
    const bad = observations.filter((o) =>
      ['faulted', 'offline'].includes(o.status),
    ).length;
    availabilityShare = good / Math.max(1, good + bad);
  }

  const reviews = station.reviews;
  const reviewAvg = reviews.length
    ? reviews.reduce((a, r) => a + r.rating, 0) / reviews.length
    : null;

  const lastVerified = station.lastVerifiedAt;
  const hoursSince = lastVerified
    ? (Date.now() - lastVerified.getTime()) / (60 * 60 * 1000)
    : null;
  const hasRecentVerification7d =
    lastVerified != null && Date.now() - lastVerified.getTime() <= 7 * DAY_MS;

  // Demo catalog has no live operator feed — never pretend otherwise
  const hasOperatorFeed = false;

  return {
    station,
    inputs: {
      successCount30d: successes.length,
      attemptCount30d: attemptCount,
      openFailures,
      crowdSamples30d: crowdSamples,
      powerRatio,
      availabilityShare,
      hasOperatorFeed,
      hoursSinceVerification: hoursSince,
      reviewAvg,
      reviewCount: reviews.length,
      hasRecentVerification7d,
      queueReports30d: queueReports.length,
    },
  };
}

export async function recomputeStationReliability(
  stationId: string,
): Promise<ReliabilityResult | null> {
  const gathered = await gatherReliabilityInputs(stationId);
  if (!gathered) return null;

  const result = computeReliabilityScore(gathered.inputs);
  result.last_verified_at = gathered.station.lastVerifiedAt?.toISOString() ?? null;

  await prisma.stationReliability.upsert({
    where: { stationId },
    create: {
      stationId,
      score: result.score,
      confidence: result.confidence,
      componentsJson: JSON.stringify(result.components),
      sampleSizesJson: JSON.stringify(result.sample_sizes),
      weightsJson: JSON.stringify(result.weights_applied),
      display: result.display,
      computedAt: new Date(),
    },
    update: {
      score: result.score,
      confidence: result.confidence,
      componentsJson: JSON.stringify(result.components),
      sampleSizesJson: JSON.stringify(result.sample_sizes),
      weightsJson: JSON.stringify(result.weights_applied),
      display: result.display,
      computedAt: new Date(),
    },
  });

  await prisma.station.update({
    where: { id: stationId },
    data: {
      reliabilityScore: result.score,
      reliabilityConfidence: result.confidence,
      reliabilityUpdatedAt: new Date(),
    },
  });

  return result;
}

export async function recomputeAllReliability() {
  const stations = await prisma.station.findMany({
    where: { deletedAt: null },
    select: { id: true },
  });
  const job = await prisma.reliabilityJob.create({
    data: { status: 'running', startedAt: new Date() },
  });
  let touched = 0;
  for (const s of stations) {
    await recomputeStationReliability(s.id);
    touched += 1;
  }
  await prisma.reliabilityJob.update({
    where: { id: job.id },
    data: {
      status: 'completed',
      stationsTouched: touched,
      finishedAt: new Date(),
      note: 'Crowdsource recompute — no OEM/operator live feed',
    },
  });
  return { job_id: job.id, stations_touched: touched };
}

export function reliabilitySummary(station: {
  reliabilityScore: number | null;
  reliabilityConfidence: number | null;
  lastVerifiedAt: Date | null;
  quarantineUntil: Date | null;
}) {
  const quarantined =
    station.quarantineUntil != null && station.quarantineUntil > new Date();
  return {
    score: station.reliabilityScore,
    confidence: station.reliabilityConfidence,
    last_verified_at: station.lastVerifiedAt?.toISOString() ?? null,
    quarantined,
    provenance: 'crowdsource' as const,
    note: 'Crowdsource ≠ operator telemetry',
  };
}

export async function findAlternatives(opts: {
  stationId: string;
  lat?: number;
  lng?: number;
  limit?: number;
}) {
  const station = await prisma.station.findFirst({
    where: { id: opts.stationId, deletedAt: null },
    include: { connectors: true, tariffs: true },
  });
  if (!station) return null;

  const lat = opts.lat ?? station.lat;
  const lng = opts.lng ?? station.lng;
  const limit = opts.limit ?? 5;

  const others = await prisma.station.findMany({
    where: {
      deletedAt: null,
      status: 'active',
      id: { not: station.id },
      OR: [{ quarantineUntil: null }, { quarantineUntil: { lt: new Date() } }],
    },
    include: { connectors: true, tariffs: true, operator: true },
  });

  const typed = station.connectors.map((c) => c.connectorType);

  return others
    .map((s) => {
      const distance_m = Math.round(haversineKm({ lat, lng }, { lat: s.lat, lng: s.lng }) * 1000);
      const compatible = s.connectors.some((c) => typed.includes(c.connectorType));
      const maxKw = Math.max(0, ...s.connectors.map((c) => c.powerKw));
      return {
        id: s.id,
        name: s.name,
        distance_m,
        city: s.city,
        is_demo: s.isDemo,
        compatible,
        max_power_kw: maxKw,
        tariff_hint_paise_per_kwh: s.tariffs[0]?.energyRatePaise ?? null,
        reliability: reliabilitySummary(s),
        last_verified_at: s.lastVerifiedAt?.toISOString() ?? null,
        operator: s.operator
          ? { id: s.operator.id, name: s.operator.name, code: s.operator.code }
          : null,
      };
    })
    .filter((s) => s.compatible && s.distance_m <= 80000)
    .sort((a, b) => {
      const ra = a.reliability.score ?? 0;
      const rb = b.reliability.score ?? 0;
      if (rb !== ra) return rb - ra;
      return a.distance_m - b.distance_m;
    })
    .slice(0, limit);
}

/** Anti-spam: max reports per user/station/day and global/day. */
export async function checkReportRateLimit(userId: string, stationId: string) {
  const since = new Date(Date.now() - DAY_MS);
  const [perStation, global] = await Promise.all([
    prisma.failureReport.count({
      where: { userId, stationId, reportedAt: { gte: since } },
    }),
    prisma.failureReport.count({
      where: { userId, reportedAt: { gte: since } },
    }),
  ]);
  if (perStation >= 5) {
    return { ok: false as const, error: 'Rate limit: max 5 reports per station per day' };
  }
  if (global >= 20) {
    return { ok: false as const, error: 'Rate limit: max 20 reports per day' };
  }
  // New accounts (<1h) limited harder
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (user && Date.now() - user.createdAt.getTime() < 60 * 60 * 1000 && global >= 3) {
    return {
      ok: false as const,
      error: 'New account rate limit: max 3 reports in first hour',
    };
  }
  return { ok: true as const };
}

export async function createInAppNotification(opts: {
  userId: string;
  type: string;
  title: string;
  body: string;
  payload?: Record<string, unknown>;
}) {
  const channel = process.env.FCM_SERVER_KEY ? 'push' : 'inapp';
  const row = await prisma.notification.create({
    data: {
      userId: opts.userId,
      channel,
      type: opts.type,
      title: opts.title,
      body: opts.body,
      payloadJson: JSON.stringify(opts.payload ?? {}),
      status: 'sent',
      sentAt: new Date(),
    },
  });

  // FCM plumbing: only attempt if key present (never invent delivery)
  if (process.env.FCM_SERVER_KEY) {
    const tokens = await prisma.pushToken.findMany({ where: { userId: opts.userId } });
    // Placeholder — real FCM HTTP call would go here when keys exist
    console.log(
      `[EVSaathi FCM] would push to ${tokens.length} token(s) type=${opts.type} (key present)`,
    );
  }

  return row;
}

export function parseMediaUrls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((u): u is string => typeof u === 'string').slice(0, 5);
}

export { parseJson };
