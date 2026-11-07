/**
 * Subscription entitlements scaffolding (P4-S01).
 * Payment provider is stubbed — entitlements are the product contract.
 */

export type SubscriptionTier = 'free' | 'plus' | 'family' | 'fleet';

export type EntitlementKey =
  | 'ad_free'
  | 'advanced_trip_strategies'
  | 'battery_health_trends'
  | 'community_photo_uploads'
  | 'family_garage_slots'
  | 'fleet_dashboard'
  | 'business_exports'
  | 'priority_moderation';

export interface PlanDefinition {
  id: SubscriptionTier;
  name: string;
  price_inr_monthly: number | null;
  entitlements: EntitlementKey[];
  garage_vehicle_limit: number;
  note: string;
}

export const SUBSCRIPTION_PLANS: readonly PlanDefinition[] = [
  {
    id: 'free',
    name: 'EVSaathi Free',
    price_inr_monthly: 0,
    entitlements: ['community_photo_uploads'],
    garage_vehicle_limit: 2,
    note: 'Core companion — manual forever, no fabricated LIVE data.',
  },
  {
    id: 'plus',
    name: 'EVSaathi Plus',
    price_inr_monthly: 199,
    entitlements: [
      'ad_free',
      'advanced_trip_strategies',
      'battery_health_trends',
      'community_photo_uploads',
      'priority_moderation',
    ],
    garage_vehicle_limit: 5,
    note: 'Stub billing — entitlements enforced in-app; payment provider optional.',
  },
  {
    id: 'family',
    name: 'EVSaathi Family',
    price_inr_monthly: 349,
    entitlements: [
      'ad_free',
      'advanced_trip_strategies',
      'battery_health_trends',
      'community_photo_uploads',
      'family_garage_slots',
      'priority_moderation',
    ],
    garage_vehicle_limit: 8,
    note: 'Shared garage roles stub — consent still required per vehicle link.',
  },
  {
    id: 'fleet',
    name: 'EVSaathi Fleet (stub)',
    price_inr_monthly: null,
    entitlements: [
      'ad_free',
      'advanced_trip_strategies',
      'battery_health_trends',
      'community_photo_uploads',
      'family_garage_slots',
      'fleet_dashboard',
      'business_exports',
      'priority_moderation',
    ],
    garage_vehicle_limit: 100,
    note: 'SME/fleet stub — contact sales; no live partner claim.',
  },
] as const;

export function getPlan(tier: SubscriptionTier): PlanDefinition {
  return SUBSCRIPTION_PLANS.find((p) => p.id === tier) ?? SUBSCRIPTION_PLANS[0];
}

export function hasEntitlement(
  tier: SubscriptionTier,
  key: EntitlementKey,
): boolean {
  return getPlan(tier).entitlements.includes(key);
}

export interface EntitlementCheckResult {
  allowed: boolean;
  tier: SubscriptionTier;
  entitlement: EntitlementKey;
  reason: string;
}

export function checkEntitlement(
  tier: SubscriptionTier,
  key: EntitlementKey,
): EntitlementCheckResult {
  const allowed = hasEntitlement(tier, key);
  return {
    allowed,
    tier,
    entitlement: key,
    reason: allowed
      ? `Included in ${getPlan(tier).name}`
      : `${key} requires a plan that includes this entitlement (stub payments OK)`,
  };
}

/** Stub payment result — never claims a real PSP charge succeeded unless wired. */
export interface StubCheckoutResult {
  status: 'stub_pending' | 'stub_activated';
  payment_provider: 'stub';
  tier: SubscriptionTier;
  note: string;
}

export function stubActivateSubscription(tier: SubscriptionTier): StubCheckoutResult {
  if (tier === 'free') {
    return {
      status: 'stub_activated',
      payment_provider: 'stub',
      tier: 'free',
      note: 'Free tier — no payment.',
    };
  }
  return {
    status: 'stub_activated',
    payment_provider: 'stub',
    tier,
    note: 'Payment stub activated entitlements locally. No UPI/card charge was processed.',
  };
}
