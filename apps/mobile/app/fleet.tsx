import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '../src/api';
import {
  Banner,
  BrandMark,
  Button,
  Chip,
  EmptyState,
  LoadingBlock,
  Screen,
  SectionTitle,
} from '../src/components';
import { colors, fonts, spacing } from '../src/theme';

type Org = {
  org_id: string;
  name: string;
  slug: string;
  status: string;
  role: string;
  vehicle_count: number;
  member_count: number;
  note: string;
};

type Analytics = {
  utilization: {
    vehicle_count: number;
    session_count: number;
    energy_kwh: number;
    cost_inr: number;
    avg_kwh_per_vehicle: number;
  };
  export_allowed: boolean;
  stub: boolean;
  note: string;
};

export default function FleetScreen() {
  const router = useRouter();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const o = await api<{ data: Org[] }>('/fleet/orgs');
      setOrgs(o.data);
      if (o.data[0]) {
        const a = await api<Analytics>(`/fleet/orgs/${o.data[0].org_id}/analytics`);
        setAnalytics(a);
      } else {
        setAnalytics(null);
      }
    } catch (e: any) {
      setError(e.message || 'Fleet stub unavailable');
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

  if (loading && !orgs.length) {
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
        <SectionTitle>Fleet (stub)</SectionTitle>
        <Text style={styles.sub}>SME org + roles stub. Not a live telematics fleet product.</Text>
        <Chip label="MVP stub" tone="demo" />

        {error ? <Banner tone="warn" text={error} /> : null}

        {!orgs.length ? (
          <EmptyState
            title="No fleet org"
            body="Admin seed includes demo-sme-fleet. Activate Fleet plan (stub) or sign in as admin."
          />
        ) : (
          orgs.map((o) => (
            <View key={o.org_id} style={styles.card}>
              <Text style={styles.value}>{o.name}</Text>
              <Text style={styles.meta}>
                @{o.slug} · role {o.role} · {o.vehicle_count} vehicles · {o.member_count} members
              </Text>
              <Text style={styles.body}>{o.note}</Text>
            </View>
          ))
        )}

        {analytics ? (
          <View style={styles.card}>
            <Text style={styles.label}>Business analytics stub</Text>
            <Text style={styles.value}>
              {analytics.utilization.energy_kwh} kWh · ₹{analytics.utilization.cost_inr}
            </Text>
            <Text style={styles.meta}>
              Sessions {analytics.utilization.session_count} · avg{' '}
              {analytics.utilization.avg_kwh_per_vehicle} kWh/vehicle
            </Text>
            <Text style={styles.body}>{analytics.note}</Text>
            <Banner
              text={
                analytics.export_allowed
                  ? 'CSV export entitlement available (GET /fleet/orgs/:id/export.csv)'
                  : 'CSV export locked — needs business_exports entitlement'
              }
            />
          </View>
        ) : null}

        <Button title="Refresh" variant="ghost" onPress={load} />
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
  value: { fontFamily: fonts.sansSemi, color: colors.textPrimary, fontSize: 16, marginTop: 4 },
  meta: { fontFamily: fonts.sans, color: colors.textTertiary, fontSize: 12, marginTop: 4 },
  body: { fontFamily: fonts.sans, color: colors.textSecondary, marginTop: 8, lineHeight: 20 },
});
