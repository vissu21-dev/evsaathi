import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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
  last_charge: { ended_at: string; energy_kwh: number | null; data_label: string; source?: string } | null;
  connectivity: {
    last_sync_at: string | null;
    data_label: string;
    oem_link_status: string;
    freshness?: string;
    live_claim?: boolean;
  };
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
  const heroIn = useRef(new Animated.Value(0)).current;

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

  useEffect(() => {
    if (!dash) return;
    heroIn.setValue(0);
    Animated.timing(heroIn, {
      toValue: 1,
      duration: 480,
      useNativeDriver: false,
    }).start();
  }, [dash, heroIn]);

  if (loading && !dash) {
    return (
      <Screen atmosphere>
        <LoadingBlock />
      </Screen>
    );
  }

  if (error && !dash) {
    return (
      <Screen atmosphere>
        <Banner tone="warn" text={error} />
        <Button title="Retry" onPress={load} />
      </Screen>
    );
  }

  if (!dash) {
    return (
      <Screen atmosphere>
        <EmptyState title="No vehicle" body="Add a vehicle to see your dashboard." />
      </Screen>
    );
  }

  const hasSoc = dash.soc_percent != null;

  return (
    <Screen atmosphere style={{ paddingHorizontal: 0 }}>
      <ScrollView
        contentContainerStyle={styles.pad}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.teal400} />}
      >
        <Animated.View
          style={{
            opacity: heroIn,
            transform: [
              {
                translateY: heroIn.interpolate({
                  inputRange: [0, 1],
                  outputRange: [12, 0],
                }),
              },
            ],
          }}
        >
          <View style={styles.brandHero}>
            <BrandMark size="hero" />
            <Text style={styles.promise}>Know your real range before you go.</Text>
          </View>

          <Pressable onPress={() => router.push('/garage')} style={styles.vehicleBlock}>
            <Text style={styles.vehicle}>
              {dash.nickname || `${dash.make} ${dash.model}`}
            </Text>
            <Text style={styles.meta}>
              {dash.make} {dash.model} {dash.variant || 'Pack 3'} ·{' '}
              {dash.connectivity.oem_link_status === 'linked' ? 'OEM linked' : 'manual-first'}
            </Text>
          </Pressable>

          <View style={styles.labelRow}>
            <Chip label={chipText(dash.data_label)} tone={labelTone(dash.data_label)} />
            <Text style={styles.honest}>No fake LIVE SOC</Text>
          </View>
        </Animated.View>

        {!hasSoc ? (
          <EmptyState
            title="No SOC yet"
            body="Enter battery percentage manually. Phase 1 never invents LIVE SOC."
          />
        ) : (
          <View style={styles.socHero}>
            <Text style={styles.heroLabel}>State of charge</Text>
            <SocArc percent={dash.soc_percent!} />
            <View style={styles.rangeRow}>
              <View>
                <Text style={styles.rangeNum}>{dash.range_km ?? '—'} km</Text>
                <View style={styles.rowGap}>
                  <Text style={styles.heroLabel}>Est. range · reserve on</Text>
                  <Chip label="EST." tone="est" />
                </View>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.sideNum}>{dash.range_confidence ?? '—'}%</Text>
                <Text style={styles.heroLabel}>Confidence</Text>
              </View>
            </View>
            <Text style={styles.usable}>
              Usable {dash.usable_kwh_remaining ?? '—'} kWh · pack {dash.usable_kwh_pack} kWh
            </Text>
          </View>
        )}

        <View style={styles.actions}>
          <Button title="Update SOC" onPress={() => router.push('/log-soc')} />
          <View style={styles.actionRow}>
            <Pressable style={styles.ghostLink} onPress={() => router.push('/range')}>
              <Text style={styles.ghostLinkText}>Range calc</Text>
            </Pressable>
            <Pressable style={styles.ghostLink} onPress={() => router.push('/integrations')}>
              <Text style={styles.ghostLinkText}>Integrations</Text>
            </Pressable>
            <Pressable style={styles.ghostLink} onPress={() => router.push('/assistant')}>
              <Text style={styles.ghostLinkText}>AI assist</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.metrics}>
          <Metric
            label="Recent use"
            value={
              dash.consumption_recent_kwh_per_100km != null
                ? `${dash.consumption_recent_kwh_per_100km}`
                : '—'
            }
            unit="kWh/100km"
          />
          <Metric
            label="Last charge"
            value={dash.last_charge?.energy_kwh != null ? `${dash.last_charge.energy_kwh}` : '—'}
            unit="kWh"
          />
        </View>

        {dash.connectivity.last_sync_at ? (
          <Text style={styles.sync}>
            Last observation{' '}
            {dash.connectivity.freshness ||
              new Date(dash.connectivity.last_sync_at).toLocaleString('en-IN')}
            {dash.connectivity.live_claim ? ' · LIVE authorized' : ' · not LIVE'}
          </Text>
        ) : (
          <Text style={styles.sync}>Manual ownership · no telemetry yet</Text>
        )}

        <Pressable onPress={() => router.push('/(tabs)/charging')}>
          <Text style={styles.link}>Find demo charging stations →</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

function Metric({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.heroLabel}>{label}</Text>
      <Text style={styles.statVal}>
        {value}
        <Text style={styles.statUnit}> {unit}</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: spacing[4], paddingBottom: 56, gap: 6 },
  brandHero: { gap: 8, marginBottom: 10, paddingTop: 4 },
  promise: {
    fontFamily: fonts.sans,
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginLeft: 20,
  },
  vehicleBlock: { marginTop: 4, marginBottom: 4 },
  vehicle: {
    fontFamily: fonts.display,
    color: colors.textPrimary,
    fontSize: 20,
  },
  meta: { fontFamily: fonts.sans, color: colors.textTertiary, fontSize: 12, marginTop: 2 },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
    marginTop: 4,
  },
  honest: {
    fontFamily: fonts.sansMed,
    color: colors.textTertiary,
    fontSize: 11,
    letterSpacing: 0.3,
  },
  socHero: {
    gap: 8,
    marginBottom: 4,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
  },
  rowGap: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 4 },
  heroLabel: { fontFamily: fonts.sans, color: colors.textSecondary, fontSize: 12 },
  rangeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  rangeNum: { fontFamily: fonts.monoSemi, color: colors.textPrimary, fontSize: 28 },
  sideNum: { fontFamily: fonts.mono, color: colors.amber400, fontSize: 22 },
  usable: { fontFamily: fonts.sans, color: colors.textTertiary, fontSize: 12, marginTop: 2 },
  actions: { gap: 12, marginVertical: 10 },
  actionRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  ghostLink: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  ghostLinkText: {
    fontFamily: fonts.sansSemi,
    color: colors.teal400,
    fontSize: 12,
  },
  metrics: {
    flexDirection: 'row',
    gap: 16,
    paddingTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
  },
  metric: { flex: 1, gap: 4, paddingVertical: 10 },
  statVal: { fontFamily: fonts.monoSemi, color: colors.textPrimary, fontSize: 20 },
  statUnit: { fontFamily: fonts.sans, color: colors.textTertiary, fontSize: 11 },
  sync: { fontFamily: fonts.sans, color: colors.textTertiary, fontSize: 12, marginTop: 8 },
  link: { fontFamily: fonts.sansSemi, color: colors.teal400, marginTop: 14, fontSize: 14 },
});
