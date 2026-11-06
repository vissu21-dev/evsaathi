import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '../../src/api';
import {
  Banner,
  Button,
  Chip,
  EmptyState,
  Field,
  LoadingBlock,
  Screen,
  SectionTitle,
} from '../../src/components';
import { useSession } from '../../src/session';
import { colors, fonts, spacing } from '../../src/theme';

type Station = {
  id: string;
  name: string;
  city?: string;
  distance_m: number;
  connectors: { type: string; power_kw: number; current_type: string; count: number }[];
  tariff_hint_paise_per_kwh: number | null;
  compatible: boolean;
  is_demo: boolean;
  open_now: boolean;
};

type SessionRow = {
  id: string;
  started_at: string;
  energy_kwh: number | null;
  cost_paise: number | null;
  station: { name: string; is_demo: boolean } | null;
  data_label: string;
};

export default function ChargingScreen() {
  const { vehicleId } = useSession();
  const router = useRouter();
  const [stations, setStations] = useState<Station[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [banner, setBanner] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState<'all' | 'dc' | 'ac'>('all');
  const [minKw, setMinKw] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams({
        lat: '19.076',
        lng: '72.877',
        radius_m: '800000',
      });
      if (vehicleId) params.set('vehicle_id', vehicleId);
      if (current !== 'all') params.set('current', current);
      if (minKw) params.set('min_power_kw', minKw);
      const [st, sess] = await Promise.all([
        api<{ data: Station[]; banner: string | null }>(`/stations/search?${params}`, {
          auth: false,
        }),
        api<{ data: SessionRow[] }>('/sessions'),
      ]);
      setStations(st.data);
      setBanner(st.banner);
      setSessions(sess.data);
    } catch (e: any) {
      setError(e.message || 'Failed to load charging data');
    } finally {
      setLoading(false);
    }
  }, [vehicleId, current, minKw]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load]),
  );

  return (
    <Screen style={{ paddingHorizontal: 0 }}>
      <ScrollView
        contentContainerStyle={styles.pad}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.teal400} />}
      >
        <SectionTitle>Charging</SectionTitle>
        <Text style={styles.sub}>Stations · manual sessions · home cost estimate</Text>

        {banner ? <Banner tone="warn" text={banner} /> : null}
        {error ? <Banner tone="warn" text={error} /> : null}

        <View style={styles.actions}>
          <Button title="Log manual session" onPress={() => router.push('/log-session')} />
        </View>

        <Text style={styles.filterLabel}>Compatibility filters</Text>
        <View style={styles.filters}>
          {(['all', 'dc', 'ac'] as const).map((c) => (
            <Pressable
              key={c}
              onPress={() => setCurrent(c)}
              style={[styles.pill, current === c && styles.pillOn]}
            >
              <Text style={[styles.pillText, current === c && styles.pillTextOn]}>
                {c.toUpperCase()}
              </Text>
            </Pressable>
          ))}
        </View>
        <Field
          label="Min power (kW)"
          value={minKw}
          onChangeText={setMinKw}
          keyboardType="decimal-pad"
          placeholder="e.g. 50"
          onEndEditing={load}
        />

        <SectionTitle>Nearby stations</SectionTitle>
        {loading && !stations.length ? <LoadingBlock /> : null}
        {!loading && !stations.length ? (
          <EmptyState title="No stations" body="No demo stations match these filters." />
        ) : null}

        <View style={{ gap: 10 }}>
          {stations.slice(0, 12).map((s) => (
            <Pressable
              key={s.id}
              style={styles.card}
              onPress={() => router.push(`/stations/${s.id}`)}
            >
              <View style={styles.rowBetween}>
                <Text style={styles.cardTitle}>{s.name}</Text>
                {s.is_demo ? <Chip label="DEMO" tone="demo" /> : null}
              </View>
              <Text style={styles.meta}>
                {s.city || '—'} · {(s.distance_m / 1000).toFixed(1)} km
                {s.compatible ? ' · compatible' : ' · check connector'}
              </Text>
              <Text style={styles.meta}>
                {s.connectors
                  .map((c) => `${c.count}× ${c.type} ${c.power_kw} kW`)
                  .join(' · ')}
              </Text>
              <Text style={styles.meta}>
                Tariff hint{' '}
                {s.tariff_hint_paise_per_kwh != null
                  ? `₹${(s.tariff_hint_paise_per_kwh / 100).toFixed(0)}/kWh`
                  : '—'}{' '}
                · MANUAL/DEMO — not live
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={{ height: 20 }} />
        <SectionTitle>Session history</SectionTitle>
        {!sessions.length ? (
          <EmptyState title="No sessions yet" body="Log a manual charge to build cost history." />
        ) : (
          <View style={{ gap: 8 }}>
            {sessions.slice(0, 8).map((s) => (
              <View key={s.id} style={styles.card}>
                <View style={styles.rowBetween}>
                  <Text style={styles.cardTitle}>
                    {s.station?.name || 'Home / unlisted'}
                  </Text>
                  <Chip label="MANUAL" tone="manual" />
                </View>
                <Text style={styles.meta}>
                  {new Date(s.started_at).toLocaleString('en-IN')} · {s.energy_kwh ?? '—'} kWh · ₹
                  {s.cost_paise != null ? (s.cost_paise / 100).toFixed(0) : '—'}
                </Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing[4], paddingBottom: 48 },
  sub: { fontFamily: fonts.sans, color: colors.textSecondary, marginBottom: 12 },
  actions: { marginBottom: 12 },
  filterLabel: { fontFamily: fonts.sansMed, color: colors.textSecondary, marginBottom: 8 },
  filters: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  pill: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  pillOn: { borderColor: colors.teal400, backgroundColor: 'rgba(46,230,166,0.1)' },
  pillText: { fontFamily: fonts.sansSemi, color: colors.textTertiary, fontSize: 12 },
  pillTextOn: { color: colors.teal400 },
  card: {
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgElevated,
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  cardTitle: { fontFamily: fonts.sansSemi, color: colors.textPrimary, flex: 1 },
  meta: { fontFamily: fonts.sans, color: colors.textTertiary, fontSize: 12 },
});
