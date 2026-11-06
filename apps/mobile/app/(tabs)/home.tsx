import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '../../src/api';
import {
  Banner,
  BrandMark,
  Button,
  Chip,
  EmptyState,
  LoadingBlock,
  Screen,
  SocArc,
  chipText,
  labelTone,
} from '../../src/components';
import { useSession } from '../../src/session';
import { colors, fonts, spacing } from '../../src/theme';

type Dash = {
  nickname?: string;
  make: string;
  model: string;
  variant?: string;
  soc_percent: number | null;
  range_km: number | null;
  range_confidence: number | null;
  usable_kwh_remaining: number | null;
  usable_kwh_pack: number;
  consumption_recent_kwh_per_100km: number | null;
  last_charge: { ended_at: string; energy_kwh: number | null; data_label: string } | null;
  connectivity: { last_sync_at: string | null; data_label: string; oem_link_status: string };
  data_label: string;
  range_assumptions: string[];
  labels_note: string;
};

export default function HomeScreen() {
  const { vehicleId } = useSession();
  const router = useRouter();
  const [dash, setDash] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!vehicleId) return;
    setError(null);
    try {
      const d = await api<Dash>(`/vehicles/${vehicleId}/dashboard`);
      setDash(d);
    } catch (e: any) {
      setError(e.message || 'Dashboard unavailable');
    } finally {
      setLoading(false);
    }
  }, [vehicleId]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load]),
  );

  if (loading && !dash) {
    return (
      <Screen>
        <LoadingBlock />
      </Screen>
    );
  }

  if (error && !dash) {
    return (
      <Screen>
        <Banner tone="warn" text={error} />
        <Button title="Retry" onPress={load} />
      </Screen>
    );
  }

  if (!dash) {
    return (
      <Screen>
        <EmptyState title="No vehicle" body="Add a vehicle to see your dashboard." />
      </Screen>
    );
  }

  const hasSoc = dash.soc_percent != null;

  return (
    <Screen style={{ paddingHorizontal: 0 }}>
      <ScrollView
        contentContainerStyle={styles.pad}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.teal400} />}
      >
        <View style={styles.topRow}>
          <BrandMark size="sm" />
          <Chip label={chipText(dash.data_label)} tone={labelTone(dash.data_label)} />
        </View>

        <Text style={styles.vehicle}>
          {dash.nickname || `${dash.make} ${dash.model}`}
        </Text>
        <Text style={styles.meta}>
          {dash.make} {dash.model} {dash.variant} · OEM link: {dash.connectivity.oem_link_status}
        </Text>

        <Banner text={dash.labels_note} />

        {!hasSoc ? (
          <EmptyState
            title="No SOC yet"
            body="Enter battery percentage manually. Phase 1 does not invent live OEM SOC."
          />
        ) : (
          <View style={styles.heroCard}>
            <View style={styles.rowBetween}>
              <Text style={styles.heroLabel}>State of charge</Text>
              <Chip label={chipText(dash.data_label)} tone={labelTone(dash.data_label)} />
            </View>
            <SocArc percent={dash.soc_percent!} />
            <View style={styles.rangeRow}>
              <View>
                <Text style={styles.rangeNum}>{dash.range_km ?? '—'} km</Text>
                <View style={styles.rowGap}>
                  <Text style={styles.heroLabel}>Est. range (w/ reserve)</Text>
                  <Chip label="EST." tone="est" />
                </View>
              </View>
              <View>
                <Text style={styles.sideNum}>{dash.range_confidence ?? '—'}%</Text>
                <Text style={styles.heroLabel}>Confidence</Text>
              </View>
            </View>
            <Text style={styles.usable}>
              Usable remaining {dash.usable_kwh_remaining ?? '—'} kWh · pack {dash.usable_kwh_pack} kWh
            </Text>
          </View>
        )}

        <View style={styles.actions}>
          <Button title="Update SOC" onPress={() => router.push('/log-soc')} />
          <Button title="Range calculator" variant="ghost" onPress={() => router.push('/range')} />
        </View>

        <View style={styles.grid}>
          <Stat
            label="Recent consumption"
            value={
              dash.consumption_recent_kwh_per_100km != null
                ? `${dash.consumption_recent_kwh_per_100km}`
                : '—'
            }
            unit="kWh/100km"
            chip="EST./MANUAL"
          />
          <Stat
            label="Last charge"
            value={dash.last_charge?.energy_kwh != null ? `${dash.last_charge.energy_kwh}` : '—'}
            unit="kWh"
            chip={dash.last_charge ? 'MANUAL' : '—'}
          />
        </View>

        {dash.connectivity.last_sync_at ? (
          <Text style={styles.sync}>
            Last manual update {new Date(dash.connectivity.last_sync_at).toLocaleString('en-IN')}
          </Text>
        ) : (
          <Text style={styles.sync}>No telemetry samples yet</Text>
        )}

        <Pressable onPress={() => router.push('/(tabs)/charging')}>
          <Text style={styles.link}>Find demo charging stations →</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

function Stat({
  label,
  value,
  unit,
  chip,
}: {
  label: string;
  value: string;
  unit: string;
  chip: string;
}) {
  return (
    <View style={styles.stat}>
      <Text style={styles.heroLabel}>{label}</Text>
      <Text style={styles.statVal}>
        {value}
        <Text style={styles.statUnit}> {unit}</Text>
      </Text>
      <Chip label={chip} tone="est" />
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing[4], paddingBottom: 48, gap: 8 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  vehicle: {
    fontFamily: fonts.display,
    color: colors.textPrimary,
    fontSize: 22,
    marginTop: 12,
  },
  meta: { fontFamily: fonts.sans, color: colors.textTertiary, marginBottom: 8 },
  heroCard: {
    backgroundColor: colors.bgElevated,
    borderColor: colors.borderSubtle,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 8,
    marginBottom: 8,
  },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowGap: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 4 },
  heroLabel: { fontFamily: fonts.sans, color: colors.textSecondary, fontSize: 12 },
  rangeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  rangeNum: { fontFamily: fonts.monoSemi, color: colors.textPrimary, fontSize: 28 },
  sideNum: { fontFamily: fonts.mono, color: colors.amber400, fontSize: 22, textAlign: 'right' },
  usable: { fontFamily: fonts.sans, color: colors.textTertiary, fontSize: 12, marginTop: 4 },
  actions: { gap: 10, marginVertical: 8 },
  grid: { flexDirection: 'row', gap: 10 },
  stat: {
    flex: 1,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  statVal: { fontFamily: fonts.monoSemi, color: colors.textPrimary, fontSize: 22 },
  statUnit: { fontFamily: fonts.sans, color: colors.textTertiary, fontSize: 12 },
  sync: { fontFamily: fonts.sans, color: colors.textTertiary, fontSize: 12, marginTop: 12 },
  link: { fontFamily: fonts.sansSemi, color: colors.teal400, marginTop: 16 },
});
