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
import { useSession } from '../src/session';
import { colors, fonts, spacing } from '../src/theme';

type GarageVehicle = {
  id: string;
  nickname?: string | null;
  make: string;
  model: string;
  variant?: string | null;
  is_primary: boolean;
  battery_kwh_stated: number;
  battery_kwh_usable?: number | null;
  connectors: string[];
};

type Garage = {
  tier: string;
  garage_vehicle_limit: number;
  vehicle_count: number;
  can_add_more: boolean;
  catalog_spec_count: number;
  data: GarageVehicle[];
  note: string;
};

export default function GarageScreen() {
  const router = useRouter();
  const { setVehicleId, refreshVehicle } = useSession();
  const [garage, setGarage] = useState<Garage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const g = await api<Garage>('/garage');
      setGarage(g);
    } catch (e: any) {
      setError(e.message || 'Garage unavailable');
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

  const activate = async (id: string) => {
    try {
      await api(`/garage/${id}/activate`, { method: 'POST', body: '{}' });
      await setVehicleId(id);
      await refreshVehicle();
      await load();
    } catch (e: any) {
      setError(e.message || 'Switch failed');
    }
  };

  if (loading && !garage) {
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
        <SectionTitle>Multi-brand garage</SectionTitle>
        <Text style={styles.sub}>
          Switch your active vehicle. Catalog specs are configurable — never hardcoded pack math.
        </Text>

        {garage ? (
          <Banner
            text={`Plan ${garage.tier} · ${garage.vehicle_count}/${garage.garage_vehicle_limit} slots · catalog ${garage.catalog_spec_count} specs`}
          />
        ) : null}
        {error ? <Banner tone="warn" text={error} /> : null}

        {!garage?.data.length ? (
          <EmptyState title="Empty garage" body="Add a vehicle from onboarding." />
        ) : (
          garage.data.map((v) => (
            <View key={v.id} style={styles.card}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={styles.value}>
                  {v.nickname || `${v.make} ${v.model}`}
                </Text>
                {v.is_primary ? <Chip label="Active" tone="synced" /> : null}
              </View>
              <Text style={styles.meta}>
                {v.make} {v.model} {v.variant} · stated {v.battery_kwh_stated} kWh
                {v.battery_kwh_usable != null ? ` · usable ${v.battery_kwh_usable} kWh` : ''}
              </Text>
              <Text style={styles.meta}>Connectors: {v.connectors.join(', ') || '—'}</Text>
              {!v.is_primary ? (
                <Button title="Make active" variant="ghost" onPress={() => activate(v.id)} />
              ) : null}
            </View>
          ))
        )}

        <Button title="Add / configure vehicle" onPress={() => router.push('/onboarding/vehicle')} />
        <Banner tone="warn" text={garage?.note || 'Multi-brand support'} />
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
  value: { fontFamily: fonts.sansSemi, color: colors.textPrimary, fontSize: 16, flex: 1 },
  meta: { fontFamily: fonts.sans, color: colors.textTertiary, fontSize: 12, marginTop: 4 },
});
