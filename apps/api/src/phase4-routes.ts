/**
 * Phase 4 — EV Ecosystem: community, reputation, multi-brand garage polish,
 * battery health uncertainty gates, subscriptions stub, partnerships, fleet,
 * business analytics stub.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  computeBatteryHealth,
  computeReputationScore,
  checkEntitlement,
  dailyPostCap,
  getPlan,
  stubActivateSubscription,
  SUBSCRIPTION_PLANS,
  type SubscriptionTier,
} from '@evsaathi/shared';
import { prisma } from './prisma';
import { requireAuth } from './auth';
import { sendError } from './errors';
import { effectiveSpec, getVehicleForUser, parseJson } from './vehicle-helpers';
import { catalogAdapters as adapterCatalog, listOperatorAdapters } from './adapters/registry';

export const phase4Router = Router();

const POST_TYPES = [
  'station_experience',
  'trip_share',
  'range_share',
  'cost_share',
  'tip',
  'photo',
  'discussion',
] as const;

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'moderator')) {
    return sendError(res, 403, 'FORBIDDEN', 'Admin or moderator role required');
  }
  return next();
}

function asTier(v: string | null | undefined): SubscriptionTier {
  if (v === 'plus' || v === 'family' || v === 'fleet' || v === 'free') return v;
  return 'free';
}

async function ensureReputation(userId: string) {
  const existing = await prisma.userReputation.findUnique({ where: { userId } });
  if (existing) return existing;

  const verifiedReportCount = await prisma.failureReport.count({
    where: { userId, status: { in: ['confirmed', 'resolved'] } },
  });
  const helpfulPostCount = await prisma.communityPost.count({
    where: { authorId: userId, moderationStatus: 'published', usefulCount: { gt: 0 } },
  });
  const usefulVotesReceived = await prisma.communityVote.count({
    where: { kind: 'useful', post: { authorId: userId } },
  });
  const rejectedCount = await prisma.communityPost.count({
    where: { authorId: userId, moderationStatus: 'rejected' },
  });
  const spamFlags = await prisma.communityVote.count({
    where: { kind: 'report_spam', post: { authorId: userId } },
  });

  const scored = computeReputationScore({
    events: [],
    verifiedReportCount,
    helpfulPostCount,
    usefulVotesReceived,
    rejectedCount,
    spamFlags,
  });

  return prisma.userReputation.create({
    data: {
      userId,
      score: scored.score,
      tier: scored.tier,
      verifiedReportCount,
      helpfulPostCount,
      usefulVotesReceived,
      rejectedCount,
      spamFlags,
      componentsJson: JSON.stringify(scored.components),
    },
  });
}

export async function recomputeUserReputation(userId: string) {
  const verifiedReportCount = await prisma.failureReport.count({
    where: { userId, status: { in: ['confirmed', 'resolved'] } },
  });
  const helpfulPostCount = await prisma.communityPost.count({
    where: { authorId: userId, moderationStatus: 'published', usefulCount: { gt: 0 } },
  });
  const usefulVotesReceived = await prisma.communityVote.count({
    where: { kind: 'useful', post: { authorId: userId } },
  });
  const rejectedCount = await prisma.communityPost.count({
    where: { authorId: userId, moderationStatus: 'rejected' },
  });
  const spamFlags = await prisma.communityVote.count({
    where: { kind: 'report_spam', post: { authorId: userId } },
  });
  const scored = computeReputationScore({
    events: [],
    verifiedReportCount,
    helpfulPostCount,
    usefulVotesReceived,
    rejectedCount,
    spamFlags,
  });
  return prisma.userReputation.upsert({
    where: { userId },
    create: {
      userId,
      score: scored.score,
      tier: scored.tier,
      verifiedReportCount,
      helpfulPostCount,
      usefulVotesReceived,
      rejectedCount,
      spamFlags,
      componentsJson: JSON.stringify(scored.components),
    },
    update: {
      score: scored.score,
      tier: scored.tier,
      verifiedReportCount,
      helpfulPostCount,
      usefulVotesReceived,
      rejectedCount,
      spamFlags,
      componentsJson: JSON.stringify(scored.components),
    },
  });
}

function serializePost(p: {
  id: string;
  spaceId: string;
  authorId: string;
  postType: string;
  title: string;
  body: string;
  stationId: string | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  vehicleVariant: string | null;
  metricsJson: string;
  photoUrlsJson: string;
  usefulCount: number;
  moderationStatus: string;
  createdAt: Date;
  author?: { displayName: string | null; phoneE164: string } | null;
  space?: { slug: string; title: string } | null;
}) {
  return {
    id: p.id,
    space_id: p.spaceId,
    space: p.space ? { slug: p.space.slug, title: p.space.title } : undefined,
    author_id: p.authorId,
    author_display: p.author?.displayName || p.author?.phoneE164?.slice(-4) || 'Owner',
    post_type: p.postType,
    title: p.title,
    body: p.body,
    station_id: p.stationId,
    vehicle: {
      make: p.vehicleMake,
      model: p.vehicleModel,
      variant: p.vehicleVariant,
    },
    metrics: parseJson(p.metricsJson, {}),
    photo_urls: parseJson(p.photoUrlsJson, [] as string[]),
    useful_count: p.usefulCount,
    moderation_status: p.moderationStatus,
    created_at: p.createdAt.toISOString(),
    data_label: 'manually_entered' as const,
  };
}

// ── Community spaces ──────────────────────────────────
phase4Router.get('/community/spaces', async (_req, res) => {
  const spaces = await prisma.communitySpace.findMany({
    where: { status: 'active' },
    orderBy: [{ kind: 'asc' }, { title: 'asc' }],
  });
  res.json({
    data: spaces.map((s) => ({
      id: s.id,
      slug: s.slug,
      title: s.title,
      description: s.description,
      kind: s.kind,
      make: s.make,
      model: s.model,
      variant: s.variant,
      verified_owners_only: s.isVerifiedOwnersOnly,
    })),
    note: 'Vehicle-specific spaces for verified EV owners. Crowdsource tips ≠ operator LIVE status.',
  });
});

phase4Router.get('/community/spaces/:slug/posts', async (req, res) => {
  const space = await prisma.communitySpace.findUnique({ where: { slug: req.params.slug } });
  if (!space) return sendError(res, 404, 'NOT_FOUND', 'Space not found');
  const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
  const posts = await prisma.communityPost.findMany({
    where: { spaceId: space.id, moderationStatus: 'published' },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { author: { select: { displayName: true, phoneE164: true } }, space: true },
  });
  res.json({
    space: { slug: space.slug, title: space.title, kind: space.kind },
    data: posts.map(serializePost),
  });
});

phase4Router.get('/community/feed', requireAuth, async (req, res) => {
  const make = req.query.make ? String(req.query.make) : undefined;
  const postType = req.query.post_type ? String(req.query.post_type) : undefined;
  const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '30'), 10) || 30));
  const posts = await prisma.communityPost.findMany({
    where: {
      moderationStatus: 'published',
      ...(make ? { vehicleMake: make } : {}),
      ...(postType ? { postType } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { author: { select: { displayName: true, phoneE164: true } }, space: true },
  });
  res.json({
    data: posts.map(serializePost),
    note: 'Owner-shared experiences — not live station availability.',
  });
});

phase4Router.post('/community/posts', requireAuth, async (req, res) => {
  const body = z
    .object({
      space_slug: z.string().min(2).max(80),
      post_type: z.enum(POST_TYPES),
      title: z.string().min(3).max(120),
      body: z.string().min(3).max(4000),
      station_id: z.string().uuid().optional().nullable(),
      vehicle_make: z.string().max(60).optional(),
      vehicle_model: z.string().max(60).optional(),
      vehicle_variant: z.string().max(60).optional(),
      metrics: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
      photo_urls: z.array(z.string().max(2000)).max(5).optional(),
    })
    .safeParse(req.body);
  if (!body.success) return sendError(res, 400, 'VALIDATION', 'Invalid post', body.error.flatten());

  const space = await prisma.communitySpace.findUnique({ where: { slug: body.data.space_slug } });
  if (!space || space.status !== 'active') return sendError(res, 404, 'NOT_FOUND', 'Space not found');

  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) return sendError(res, 404, 'NOT_FOUND', 'User not found');

  const rep = await ensureReputation(user.id);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentCount = await prisma.communityPost.count({
    where: { authorId: user.id, createdAt: { gte: since } },
  });
  const cap = dailyPostCap(rep.score);
  if (recentCount >= cap) {
    return sendError(res, 429, 'RATE_LIMIT', `Daily post cap (${cap}) reached for reputation tier ${rep.tier}`);
  }

  const photos = body.data.photo_urls ?? [];
  if (photos.length > 0) {
    const ent = checkEntitlement(asTier(user.subscriptionTier), 'community_photo_uploads');
    if (!ent.allowed) {
      return sendError(res, 402, 'ENTITLEMENT', ent.reason);
    }
  }

  // Photos from brand-new accounts with zero reputation go to moderation queue
  let moderationStatus = 'published';
  if (photos.length > 0 && rep.score < 10) {
    moderationStatus = 'pending';
  }

  const post = await prisma.communityPost.create({
    data: {
      spaceId: space.id,
      authorId: user.id,
      postType: body.data.post_type,
      title: body.data.title,
      body: body.data.body,
      stationId: body.data.station_id ?? null,
      vehicleMake: body.data.vehicle_make ?? null,
      vehicleModel: body.data.vehicle_model ?? null,
      vehicleVariant: body.data.vehicle_variant ?? null,
      metricsJson: JSON.stringify(body.data.metrics ?? {}),
      photoUrlsJson: JSON.stringify(photos),
      moderationStatus,
    },
    include: { author: { select: { displayName: true, phoneE164: true } }, space: true },
  });

  await recomputeUserReputation(user.id);

  res.status(201).json({
    ...serializePost(post),
    moderation_note:
      moderationStatus === 'pending'
        ? 'Photos from newcomers await moderation — anti-spam.'
        : undefined,
  });
});

phase4Router.post('/community/posts/:id/vote', requireAuth, async (req, res) => {
  const body = z.object({ kind: z.enum(['useful', 'report_spam']) }).safeParse(req.body);
  if (!body.success) return sendError(res, 400, 'VALIDATION', 'Invalid vote', body.error.flatten());

  const post = await prisma.communityPost.findUnique({ where: { id: req.params.id } });
  if (!post || post.moderationStatus === 'rejected') {
    return sendError(res, 404, 'NOT_FOUND', 'Post not found');
  }
  if (post.authorId === req.user!.id) {
    return sendError(res, 400, 'VALIDATION', 'Cannot vote on your own post');
  }

  await prisma.communityVote.upsert({
    where: {
      postId_userId_kind: {
        postId: post.id,
        userId: req.user!.id,
        kind: body.data.kind,
      },
    },
    create: { postId: post.id, userId: req.user!.id, kind: body.data.kind },
    update: {},
  });

  if (body.data.kind === 'useful') {
    const count = await prisma.communityVote.count({
      where: { postId: post.id, kind: 'useful' },
    });
    await prisma.communityPost.update({
      where: { id: post.id },
      data: { usefulCount: count },
    });
  } else {
    const spam = await prisma.communityVote.count({
      where: { postId: post.id, kind: 'report_spam' },
    });
    if (spam >= 3) {
      await prisma.communityPost.update({
        where: { id: post.id },
        data: { moderationStatus: 'hidden', moderationNotes: 'Auto-hidden after spam reports' },
      });
    }
  }

  await recomputeUserReputation(post.authorId);
  res.json({ ok: true, kind: body.data.kind });
});

// ── Reputation ────────────────────────────────────────
phase4Router.get('/me/reputation', requireAuth, async (req, res) => {
  const row = await recomputeUserReputation(req.user!.id);
  const scored = computeReputationScore({
    events: [],
    verifiedReportCount: row.verifiedReportCount,
    helpfulPostCount: row.helpfulPostCount,
    usefulVotesReceived: row.usefulVotesReceived,
    rejectedCount: row.rejectedCount,
    spamFlags: row.spamFlags,
  });
  res.json({
    score: row.score,
    tier: row.tier,
    display_label: scored.display_label,
    components: scored.components,
    verified_report_count: row.verifiedReportCount,
    helpful_post_count: row.helpfulPostCount,
    useful_votes_received: row.usefulVotesReceived,
    daily_post_cap: dailyPostCap(row.score),
    note: scored.note,
    formula_version: scored.formula_version,
  });
});

// ── Multi-brand garage polish ─────────────────────────
phase4Router.get('/garage', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  const tier = asTier(user?.subscriptionTier);
  const plan = getPlan(tier);
  const vehicles = await prisma.vehicle.findMany({
    where: { userId: req.user!.id, deletedAt: null },
    include: { vehicleSpec: true },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  });
  const catalogCount = await prisma.vehicleSpec.count();
  res.json({
    tier,
    garage_vehicle_limit: plan.garage_vehicle_limit,
    vehicle_count: vehicles.length,
    can_add_more: vehicles.length < plan.garage_vehicle_limit,
    catalog_spec_count: catalogCount,
    data: vehicles.map((v) => ({
      id: v.id,
      nickname: v.nickname,
      make: v.make,
      model: v.model,
      variant: v.variant,
      model_year: v.modelYear,
      is_primary: v.isPrimary,
      battery_kwh_stated: v.vehicleSpec.batteryKwhStated,
      battery_kwh_usable: v.vehicleSpec.batteryKwhUsable,
      connectors: parseJson(v.vehicleSpec.connectorTypesJson, [] as string[]),
      telemetry_source_preferred: v.telemetrySourcePreferred,
    })),
    note: 'Multi-brand garage — switch primary vehicle anytime. Catalog depth expanded in Phase 4 seed.',
  });
});

phase4Router.post('/garage/:id/activate', requireAuth, async (req, res) => {
  const v = await getVehicleForUser(req.params.id, req.user!.id);
  if (!v) return sendError(res, 404, 'NOT_FOUND', 'Vehicle not found');
  await prisma.vehicle.updateMany({
    where: { userId: req.user!.id, deletedAt: null },
    data: { isPrimary: false },
  });
  await prisma.vehicle.update({
    where: { id: v.id },
    data: { isPrimary: true },
  });
  res.json({
    ok: true,
    active_vehicle_id: v.id,
    make: v.make,
    model: v.model,
    variant: v.variant,
    note: 'Primary vehicle switched — dashboard, range, and community filters follow this vehicle.',
  });
});

// ── Battery health (uncertainty-gated) ────────────────
phase4Router.get('/vehicles/:id/battery-health', requireAuth, async (req, res) => {
  const vehicle = await getVehicleForUser(req.params.id, req.user!.id);
  if (!vehicle) return sendError(res, 404, 'NOT_FOUND', 'Vehicle not found');

  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  const tier = asTier(user?.subscriptionTier);
  const ent = checkEntitlement(tier, 'battery_health_trends');
  // Free tier still sees the gate/empty state — Plus unlocks deeper trend copy (stub)
  const showDeepTrends = ent.allowed;

  const spec = effectiveSpec(vehicle);
  const sessions = await prisma.chargingSession.findMany({
    where: { vehicleId: vehicle.id, status: 'completed' },
    orderBy: { startedAt: 'asc' },
  });
  const telemetry = await prisma.telemetry.findMany({
    where: { vehicleId: vehicle.id },
    orderBy: { observedAt: 'asc' },
  });

  const samples = [];
  for (const s of sessions) {
    if (s.socStart != null && s.socEnd != null && s.energyKwh != null && s.socEnd > s.socStart) {
      const delta = (s.socEnd - s.socStart) / 100;
      if (delta > 0.05) {
        samples.push({
          observed_at: s.startedAt.toISOString(),
          inferred_usable_kwh: s.energyKwh / delta,
          source: s.source,
        });
      }
    }
  }
  // Efficiency from consecutive SOC+odo telemetry
  const withOdo = telemetry.filter((t) => t.odometerKm != null);
  for (let i = 1; i < withOdo.length; i++) {
    const a = withOdo[i - 1];
    const b = withOdo[i];
    const dist = (b.odometerKm ?? 0) - (a.odometerKm ?? 0);
    const socDrop = a.socPercent - b.socPercent;
    if (dist > 5 && socDrop > 1) {
      const energy = (socDrop / 100) * spec.usableKwh;
      samples.push({
        observed_at: b.observedAt.toISOString(),
        efficiency_wh_per_km: (energy * 1000) / dist,
        odometer_km: b.odometerKm,
        source: b.source,
      });
    }
  }

  const health = computeBatteryHealth({
    catalogUsableKwh: spec.usableKwh,
    samples,
    sessionCount: sessions.length,
  });

  res.json({
    ...health,
    entitlement: {
      tier,
      battery_health_trends: showDeepTrends,
      note: showDeepTrends
        ? 'Plus/Family/Fleet entitlement active (stub billing OK).'
        : 'Free tier: gates and honesty labels always shown; upgrade unlocks richer trend narrative (stub).',
    },
    vehicle: {
      id: vehicle.id,
      make: vehicle.make,
      model: vehicle.model,
      catalog_usable_kwh: spec.usableKwh,
    },
  });
});

// ── Subscriptions ─────────────────────────────────────
phase4Router.get('/subscriptions/plans', (_req, res) => {
  res.json({
    data: SUBSCRIPTION_PLANS,
    payment_provider: 'stub',
    note: 'Entitlements scaffolding — stub payments only. No real UPI/card charge.',
  });
});

phase4Router.get('/me/subscription', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) return sendError(res, 404, 'NOT_FOUND', 'User not found');
  const tier = asTier(user.subscriptionTier);
  const plan = getPlan(tier);
  const latest = await prisma.userSubscription.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
  });
  res.json({
    tier,
    plan,
    entitlements: plan.entitlements,
    subscription: latest
      ? {
          id: latest.id,
          status: latest.status,
          payment_provider: latest.paymentProvider,
          started_at: latest.startedAt.toISOString(),
          ends_at: latest.endsAt?.toISOString() ?? null,
        }
      : null,
    note: 'Stub entitlements — payment provider optional.',
  });
});

phase4Router.post('/me/subscription/checkout', requireAuth, async (req, res) => {
  const body = z
    .object({
      tier: z.enum(['free', 'plus', 'family', 'fleet']),
    })
    .safeParse(req.body);
  if (!body.success) return sendError(res, 400, 'VALIDATION', 'Invalid tier', body.error.flatten());

  const stub = stubActivateSubscription(body.data.tier);
  const endsAt =
    body.data.tier === 'free' ? null : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await prisma.user.update({
    where: { id: req.user!.id },
    data: { subscriptionTier: body.data.tier },
  });
  const row = await prisma.userSubscription.create({
    data: {
      userId: req.user!.id,
      tier: body.data.tier,
      status: 'active',
      paymentProvider: 'stub',
      externalRef: `stub_${Date.now()}`,
      endsAt,
      metadataJson: JSON.stringify(stub),
    },
  });

  res.status(201).json({
    ...stub,
    subscription_id: row.id,
    plan: getPlan(body.data.tier),
  });
});

// ── Fleet stub ────────────────────────────────────────
phase4Router.get('/fleet/orgs', requireAuth, async (req, res) => {
  const memberships = await prisma.fleetMembership.findMany({
    where: { userId: req.user!.id },
    include: { org: { include: { vehicles: true, members: true } } },
  });
  res.json({
    data: memberships.map((m) => ({
      org_id: m.org.id,
      name: m.org.name,
      slug: m.org.slug,
      status: m.org.status,
      role: m.role,
      vehicle_count: m.org.vehicles.length,
      member_count: m.org.members.length,
      note: m.org.note,
    })),
    stub: true,
    note: 'Fleet org stub — MVP roles only; no live telematics fleet claims.',
  });
});

phase4Router.post('/fleet/orgs', requireAuth, async (req, res) => {
  const body = z
    .object({
      name: z.string().min(2).max(80),
      slug: z
        .string()
        .min(2)
        .max(40)
        .regex(/^[a-z0-9-]+$/),
    })
    .safeParse(req.body);
  if (!body.success) return sendError(res, 400, 'VALIDATION', 'Invalid org', body.error.flatten());

  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  const ent = checkEntitlement(asTier(user?.subscriptionTier), 'fleet_dashboard');
  if (!ent.allowed && user?.role !== 'admin') {
    return sendError(res, 402, 'ENTITLEMENT', `${ent.reason}. Or use admin demo to explore the stub.`);
  }

  const existing = await prisma.fleetOrg.findUnique({ where: { slug: body.data.slug } });
  if (existing) return sendError(res, 409, 'CONFLICT', 'Slug already taken');

  const org = await prisma.fleetOrg.create({
    data: {
      name: body.data.name,
      slug: body.data.slug,
      members: {
        create: { userId: req.user!.id, role: 'owner' },
      },
    },
  });
  res.status(201).json({
    id: org.id,
    name: org.name,
    slug: org.slug,
    status: org.status,
    stub: true,
    note: org.note,
  });
});

phase4Router.post('/fleet/orgs/:id/vehicles', requireAuth, async (req, res) => {
  const membership = await prisma.fleetMembership.findFirst({
    where: {
      orgId: req.params.id,
      userId: req.user!.id,
      role: { in: ['owner', 'admin'] },
    },
  });
  if (!membership) return sendError(res, 403, 'FORBIDDEN', 'Owner/admin role required');

  const body = z
    .object({
      label: z.string().min(1).max(60),
      make: z.string().min(1).max(60),
      model: z.string().min(1).max(60),
      variant: z.string().max(60).optional(),
      vehicle_id: z.string().uuid().optional(),
    })
    .safeParse(req.body);
  if (!body.success) return sendError(res, 400, 'VALIDATION', 'Invalid fleet vehicle', body.error.flatten());

  const fv = await prisma.fleetVehicle.create({
    data: {
      orgId: req.params.id,
      label: body.data.label,
      make: body.data.make,
      model: body.data.model,
      variant: body.data.variant,
      vehicleId: body.data.vehicle_id,
    },
  });
  res.status(201).json({
    id: fv.id,
    label: fv.label,
    make: fv.make,
    model: fv.model,
    stub: true,
  });
});

// ── Business analytics stub ───────────────────────────
phase4Router.get('/fleet/orgs/:id/analytics', requireAuth, async (req, res) => {
  const membership = await prisma.fleetMembership.findFirst({
    where: { orgId: req.params.id, userId: req.user!.id },
    include: { org: { include: { vehicles: true } } },
  });
  if (!membership) return sendError(res, 403, 'FORBIDDEN', 'Not a member of this org');

  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  const ent = checkEntitlement(asTier(user?.subscriptionTier), 'business_exports');

  const linkedIds = membership.org.vehicles
    .map((v) => v.vehicleId)
    .filter((id): id is string => !!id);

  let energyKwh = 0;
  let costPaise = 0;
  let sessionCount = 0;
  if (linkedIds.length) {
    const sessions = await prisma.chargingSession.findMany({
      where: { vehicleId: { in: linkedIds }, status: 'completed' },
    });
    sessionCount = sessions.length;
    energyKwh = sessions.reduce((a, s) => a + (s.energyKwh ?? 0), 0);
    costPaise = sessions.reduce(
      (a, s) => a + (s.costPaiseActual ?? s.costPaiseEstimated ?? 0),
      0,
    );
  }

  res.json({
    org_id: membership.org.id,
    stub: true,
    utilization: {
      vehicle_count: membership.org.vehicles.length,
      linked_personal_vehicles: linkedIds.length,
      session_count: sessionCount,
      energy_kwh: Math.round(energyKwh * 100) / 100,
      cost_paise: costPaise,
      cost_inr: Math.round(costPaise) / 100,
      avg_kwh_per_vehicle:
        membership.org.vehicles.length > 0
          ? Math.round((energyKwh / membership.org.vehicles.length) * 100) / 100
          : 0,
    },
    export_allowed: ent.allowed || user?.role === 'admin',
    data_label: 'manually_entered',
    note: 'Business analytics stub from linked manual/import sessions — not a live fleet telematics product.',
  });
});

phase4Router.get('/fleet/orgs/:id/export.csv', requireAuth, async (req, res) => {
  const membership = await prisma.fleetMembership.findFirst({
    where: { orgId: req.params.id, userId: req.user!.id },
    include: { org: { include: { vehicles: true } } },
  });
  if (!membership) return sendError(res, 403, 'FORBIDDEN', 'Not a member of this org');
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  const ent = checkEntitlement(asTier(user?.subscriptionTier), 'business_exports');
  if (!ent.allowed && user?.role !== 'admin') {
    return sendError(res, 402, 'ENTITLEMENT', ent.reason);
  }

  const lines = ['label,make,model,variant,status'];
  for (const v of membership.org.vehicles) {
    lines.push(
      [v.label, v.make, v.model, v.variant ?? '', v.status]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(','),
    );
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="evsaathi-fleet-${membership.org.slug}.csv"`,
  );
  res.send(lines.join('\n'));
});

// ── Partnership / operator registry polish ────────────
phase4Router.get('/partnerships/programs', async (_req, res) => {
  const programs = await prisma.partnershipProgram.findMany({
    include: { operator: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json({
    data: programs.map((p) => ({
      id: p.id,
      code: p.code,
      title: p.title,
      kind: p.kind,
      status: p.status,
      live_claim: false, // hard rule — never surface fabricated LIVE partner claims
      corridor: parseJson(p.corridorJson, [] as unknown[]),
      operator: p.operator
        ? {
            code: p.operator.code,
            name: p.operator.name,
            partnership_status: p.operator.partnershipStatus,
          }
        : null,
      note: p.note,
    })),
    note: 'Partnership programs are directory/prospect hooks. live_claim is always false until a real contract is wired.',
  });
});

phase4Router.get('/admin/operators', requireAuth, requireAdmin, async (_req, res) => {
  const operators = await prisma.operator.findMany({
    include: { _count: { select: { stations: true, partnershipPrograms: true } } },
    orderBy: { name: 'asc' },
  });
  const adapters = adapterCatalog();
  res.json({
    data: operators.map((o) => ({
      id: o.id,
      code: o.code,
      name: o.name,
      website: o.website,
      status: o.status,
      partnership_status: o.partnershipStatus,
      partnership_notes: o.partnershipNotes,
      capabilities: parseJson(o.capabilitiesJson, [] as string[]),
      adapter_id: o.adapterId,
      station_count: o._count.stations,
      program_count: o._count.partnershipPrograms,
      featured_corridors: parseJson(o.featuredCorridorJson, [] as unknown[]),
      live_claim: false,
    })),
    adapters: adapters.operator,
    note: 'Operator registry — demo/prospect only. No LIVE partnership claimed.',
  });
});

phase4Router.patch('/admin/operators/:id', requireAuth, requireAdmin, async (req, res) => {
  const body = z
    .object({
      partnership_status: z.enum(['demo', 'prospect', 'contracted', 'live']).optional(),
      partnership_notes: z.string().max(2000).optional(),
      featured_corridors: z.array(z.record(z.unknown())).optional(),
      adapter_id: z.string().max(80).nullable().optional(),
      status: z.enum(['active', 'inactive']).optional(),
    })
    .safeParse(req.body);
  if (!body.success) return sendError(res, 400, 'VALIDATION', 'Invalid operator patch', body.error.flatten());

  // Refuse to mark live without an actual adapter that is not demo — ethics gate
  if (body.data.partnership_status === 'live') {
    const adapterId = body.data.adapter_id;
    const known = listOperatorAdapters().find((a) => a.id === adapterId);
    if (!known || known.mode === 'demo' || known.mode === 'simulated') {
      return sendError(
        res,
        400,
        'LIVE_CLAIM_BLOCKED',
        'Cannot set partnership_status=live with a demo/simulated adapter. Contract a real operator feed first.',
      );
    }
  }

  const op = await prisma.operator.findUnique({ where: { id: req.params.id } });
  if (!op) return sendError(res, 404, 'NOT_FOUND', 'Operator not found');

  const updated = await prisma.operator.update({
    where: { id: op.id },
    data: {
      partnershipStatus: body.data.partnership_status,
      partnershipNotes: body.data.partnership_notes,
      featuredCorridorJson:
        body.data.featured_corridors != null
          ? JSON.stringify(body.data.featured_corridors)
          : undefined,
      adapterId: body.data.adapter_id === undefined ? undefined : body.data.adapter_id,
      status: body.data.status,
    },
  });

  res.json({
    id: updated.id,
    code: updated.code,
    partnership_status: updated.partnershipStatus,
    live_claim: false,
    note: 'Registry updated. Product still refuses fabricated LIVE availability.',
  });
});

phase4Router.post('/admin/partnerships/programs', requireAuth, requireAdmin, async (req, res) => {
  const body = z
    .object({
      code: z.string().min(2).max(40),
      title: z.string().min(3).max(120),
      kind: z.enum(['featured_corridor', 'reliability_partner', 'directory_only', 'prospect']),
      operator_id: z.string().uuid().optional(),
      corridor: z.array(z.record(z.unknown())).optional(),
      note: z.string().max(500).optional(),
    })
    .safeParse(req.body);
  if (!body.success) return sendError(res, 400, 'VALIDATION', 'Invalid program', body.error.flatten());

  const prog = await prisma.partnershipProgram.create({
    data: {
      code: body.data.code,
      title: body.data.title,
      kind: body.data.kind,
      operatorId: body.data.operator_id,
      corridorJson: JSON.stringify(body.data.corridor ?? []),
      liveClaim: false,
      status: 'draft',
      note: body.data.note ?? 'No live partnership claimed until contracted',
    },
  });
  res.status(201).json({
    id: prog.id,
    code: prog.code,
    live_claim: false,
    status: prog.status,
  });
});

// ── Community moderation ──────────────────────────────
phase4Router.get('/admin/community/moderation', requireAuth, requireAdmin, async (_req, res) => {
  const pending = await prisma.communityPost.findMany({
    where: { moderationStatus: { in: ['pending', 'hidden'] } },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { author: { select: { displayName: true, phoneE164: true } }, space: true },
  });
  res.json({
    data: pending.map(serializePost),
    note: 'Moderation queue — publish, reject, or hide. Ties into reputation penalties.',
  });
});

phase4Router.patch('/admin/community/posts/:id', requireAuth, requireAdmin, async (req, res) => {
  const body = z
    .object({
      moderation_status: z.enum(['published', 'rejected', 'hidden', 'pending']),
      moderation_notes: z.string().max(2000).optional(),
    })
    .safeParse(req.body);
  if (!body.success) return sendError(res, 400, 'VALIDATION', 'Invalid moderation', body.error.flatten());

  const post = await prisma.communityPost.findUnique({ where: { id: req.params.id } });
  if (!post) return sendError(res, 404, 'NOT_FOUND', 'Post not found');

  const updated = await prisma.communityPost.update({
    where: { id: post.id },
    data: {
      moderationStatus: body.data.moderation_status,
      moderationNotes: body.data.moderation_notes,
      moderatedById: req.user!.id,
      moderatedAt: new Date(),
    },
    include: { author: { select: { displayName: true, phoneE164: true } }, space: true },
  });
  await recomputeUserReputation(post.authorId);
  res.json(serializePost(updated));
});

phase4Router.get('/admin/community', requireAuth, requireAdmin, async (_req, res) => {
  const pending = await prisma.communityPost.count({ where: { moderationStatus: 'pending' } });
  const published = await prisma.communityPost.count({ where: { moderationStatus: 'published' } });
  const spaces = await prisma.communitySpace.count();
  const operators = await prisma.operator.count();
  res.type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"/><title>EVSaathi Phase 4 Admin</title>
<style>
body{font-family:system-ui;background:#0b1220;color:#e8eef7;padding:24px}
h1{color:#2dd4bf} .note{color:#94a3b8} a{color:#67e8f9} .card{background:#111827;border:1px solid #1f2937;border-radius:12px;padding:16px;margin:12px 0}
</style></head><body>
<h1>EVSaathi · Phase 4 ecosystem</h1>
<p class="note">Community moderation · operator registry · partnerships. No fabricated LIVE partner claims.</p>
<div class="card"><strong>Spaces</strong> ${spaces} · <strong>Published posts</strong> ${published} · <strong>Pending</strong> ${pending}</div>
<div class="card"><strong>Operators</strong> ${operators} — GET /v1/admin/operators</div>
<div class="card">Moderation: GET /v1/admin/community/moderation · PATCH /v1/admin/community/posts/:id</div>
<div class="card">Partnerships: GET /v1/partnerships/programs · POST /v1/admin/partnerships/programs</div>
</body></html>`);
});
