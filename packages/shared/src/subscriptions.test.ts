import { describe, expect, it } from 'vitest';
import {
  checkEntitlement,
  getPlan,
  hasEntitlement,
  stubActivateSubscription,
  SUBSCRIPTION_PLANS,
} from './subscriptions';

describe('subscription entitlements', () => {
  it('defines free through fleet plans', () => {
    expect(SUBSCRIPTION_PLANS.map((p) => p.id)).toEqual(['free', 'plus', 'family', 'fleet']);
  });

  it('free lacks fleet dashboard; fleet includes exports', () => {
    expect(hasEntitlement('free', 'fleet_dashboard')).toBe(false);
    expect(hasEntitlement('fleet', 'business_exports')).toBe(true);
    expect(hasEntitlement('plus', 'battery_health_trends')).toBe(true);
  });

  it('checkEntitlement explains denials', () => {
    const r = checkEntitlement('free', 'fleet_dashboard');
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/entitlement/i);
  });

  it('stub payment never claims a real PSP', () => {
    const r = stubActivateSubscription('plus');
    expect(r.payment_provider).toBe('stub');
    expect(r.status).toBe('stub_activated');
    expect(r.note).toMatch(/No UPI|stub/i);
    expect(getPlan('plus').price_inr_monthly).toBe(199);
  });
});
