import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '../src/api';
import {
  Banner,
  BrandMark,
  Button,
  Chip,
  LoadingBlock,
  Screen,
  SectionTitle,
} from '../src/components';
import { colors, fonts, spacing } from '../src/theme';

type Plan = {
  id: string;
  name: string;
  price_inr_monthly: number | null;
  entitlements: string[];
  garage_vehicle_limit: number;
  note: string;
};

type Sub = {
  tier: string;
  plan: Plan;
  entitlements: string[];
  note: string;
};

export default function SubscriptionScreen() {
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [mine, setMine] = useState<Sub | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [p, m] = await Promise.all([
        api<{ data: Plan[] }>('/subscriptions/plans'),
        api<Sub>('/me/subscription'),
      ]);
      setPlans(p.data);
      setMine(m);
    } catch (e: any) {
      setError(e.message || 'Subscriptions unavailable');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load]),
  );

  const checkout = async (tier: string) => {
    setBusy(tier);
    setError(null);
    try {
      await api('/me/subscription/checkout', {
        method: 'POST',
        body: JSON.stringify({ tier }),
      });
      await load();
    } catch (e: any) {
      setError(e.message || 'Checkout failed');
    } finally {
      setBusy(null);
    }
  };

  if (loading && !mine) {
    return (
      <Screen>
        <LoadingBlock />
      </Screen>
    );
  }

  return (
    <Screen style={{ paddingHorizontal: 0 }}>
      <ScrollView
        contentContainerStyle={styles.pad}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.teal400} />}
      >
        <Pressable onPress={() => router.back()}>
          <Text style={styles.back}>← Profile</Text>
        </Pressable>
        <BrandMark />
        <SectionTitle>Subscriptions</SectionTitle>
        <Text style={styles.sub}>Entitlements scaffolding — payment provider is a stub. No real UPI charge.</Text>

        {mine ? (
          <View style={styles.card}>
            <Text style={styles.label}>Current plan</Text>
            <Text style={styles.value}>{mine.plan.name}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {mine.entitlements.map((e) => (
                <Chip key={e} label={e.replace(/_/g, ' ')} tone="synced" />
              ))}
            </View>
          </View>
        ) : null}

        {error ? <Banner tone="warn" text={error} /> : null}
        <Banner tone="warn" text="Stub billing only — never claims a live PSP settlement." />

        {plans.map((p) => (
          <View key={p.id} style={styles.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={styles.value}>{p.name}</Text>
              <Text style={styles.price}>
                {p.price_inr_monthly == null ? 'Custom' : p.price_inr_monthly === 0 ? 'Free' : `₹${p.price_inr_monthly}/mo`}
              </Text>
            </View>
            <Text style={styles.meta}>Garage slots {p.garage_vehicle_limit}</Text>
            <Text style={styles.body}>{p.note}</Text>
            <Button
              title={busy === p.id ? 'Activating…' : mine?.tier === p.id ? 'Active' : 'Activate stub'}
              variant={mine?.tier === p.id ? 'ghost' : 'primary'}
              disabled={mine?.tier === p.id || busy === p.id}
              onPress={() => checkout(p.id)}
            />
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing[4], paddingBottom: 48, gap: 8 },
  back: { fontFamily: fonts.sansMed, color: colors.teal400, marginBottom: 8 },
  sub: { fontFamily: fonts.sans, color: colors.textSecondary, marginBottom: 8 },
  card: {
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  label: { fontFamily: fonts.sans, color: colors.textTertiary, fontSize: 12 },
  value: { fontFamily: fonts.sansSemi, color: colors.textPrimary, fontSize: 16 },
  price: { fontFamily: fonts.sansSemi, color: colors.teal400 },
  meta: { fontFamily: fonts.sans, color: colors.textTertiary, fontSize: 12, marginTop: 4 },
  body: { fontFamily: fonts.sans, color: colors.textSecondary, marginVertical: 8, lineHeight: 20 },
});
