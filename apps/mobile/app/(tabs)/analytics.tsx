import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api } from '../../src/api';
import {
  Banner,
  Chip,
  EmptyState,
  LoadingBlock,
  Screen,
  SectionTitle,
} from '../../src/components';
import { useSession } from '../../src/session';
import { colors, fonts, spacing } from '../../src/theme';

type Analytics = {
  period: string;
  series: { date: string; energy_kwh: number; cost_paise: number; soc_samples: number }[];
  totals: {
    energy_kwh: number;
    cost_paise: number;
    session_count: number;
    kwh_per_km: number | null;
    kwh_per_100km: number | null;
  };
  data_label: string;
  note: string;
};

type CostSummary = {
  home: { amount_paise: number; energy_kwh: number; count: number };
  public: { amount_paise: number; energy_kwh: number; count: number };
  total: { amount_paise: number; energy_kwh: number; count: number };
};

type SessionRow = { id: string; energy_kwh: number | null; started_at: string; station: { name: string } | null };
type SessionAnalytics = {
  avg_power_kw: number | null;
  max_power_kw: number | null;
  duration_min: number | null;
  power_curve: { t: number; power_kw: number; soc?: number }[];
  data_label: string;
  note: string;
};

type Advanced = {
  richness: string;
  sample_count: number;
  adapter_sample_count: number;
  mean_charge_power_kw: number | null;
  peak_charge_power_kw: number | null;
  energy_per_session_kwh: number | null;
  estimated_cycles: number | null;
  efficiency_trend_kwh_per_100km: number | null;
  notes: string[];
  data_label: string;
};

export default function AnalyticsScreen() {
  const { vehicleId } = useSession();
  const [data, setData] = useState<Analytics | null>(null);
  const [costs, setCosts] = useState<CostSummary | null>(null);
  const [sessionA, setSessionA] = useState<SessionAnalytics | null>(null);
  const [advanced, setAdvanced] = useState<Advanced | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!vehicleId) return;
    setError(null);
    try {
      const [a, c, sessions, adv] = await Promise.all([
        api<Analytics>(`/vehicles/${vehicleId}/analytics/consumption?period=week`),
        api<CostSummary>(`/costs/summary?vehicle_id=${vehicleId}`),
        api<{ data: SessionRow[] }>('/sessions'),
        api<Advanced>(`/vehicles/${vehicleId}/analytics/advanced`),
      ]);
      setData(a);
      setCosts(c);
      setAdvanced(adv);
      if (sessions.data[0]) {
        const sa = await api<SessionAnalytics>(`/sessions/${sessions.data[0].id}/analytics`);
        setSessionA(sa);
      } else {
        setSessionA(null);
      }
    } catch (e: any) {
      setError(e.message || 'Analytics failed');
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

  if (loading && !data) {
    return (
      <Screen>
        <LoadingBlock />
      </Screen>
    );
  }

  const maxEnergy = Math.max(1, ...(data?.series.map((s) => s.energy_kwh) || [1]));

  return (
    <Screen style={{ paddingHorizontal: 0 }}>
      <ScrollView
        contentContainerStyle={styles.pad}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.teal400} />}
      >
        <SectionTitle>Analytics</SectionTitle>
        <Text style={styles.sub}>Consumption & costs from your logged app data — not fabricated live OEM.</Text>
        {error ? <Banner tone="warn" text={error} /> : null}
        {data ? <Banner text={data.note} /> : null}

        <View style={styles.rowBetween}>
          <Text style={styles.label}>Weekly energy from sessions</Text>
          <Chip label={data?.data_label === 'manually_entered' ? 'MANUAL' : 'EST.'} tone="manual" />
        </View>

        {!data?.series.length ? (
          <EmptyState
            title="No chart data yet"
            body="Log SOC with odometer and charging sessions to populate real charts."
          />
        ) : (
          <View style={styles.chart}>
            {data.series.map((s) => (
              <View key={s.date} style={styles.barCol}>
                <View
                  style={[
                    styles.bar,
                    { height: Math.max(4, (s.energy_kwh / maxEnergy) * 120) },
                  ]}
                />
                <Text style={styles.barLabel}>{s.date.slice(5)}</Text>
                <Text style={styles.barVal}>{s.energy_kwh.toFixed(1)}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={styles.grid}>
          <Metric
            label="kWh / km"
            value={data?.totals.kwh_per_km != null ? data.totals.kwh_per_km.toFixed(3) : '—'}
            chip="EST."
          />
          <Metric
            label="kWh / 100km"
            value={
              data?.totals.kwh_per_100km != null ? data.totals.kwh_per_100km.toFixed(1) : '—'
            }
            chip="EST."
          />
        </View>
        <View style={styles.grid}>
          <Metric label="Sessions (period)" value={`${data?.totals.session_count ?? 0}`} chip="MANUAL" />
          <Metric
            label="Energy charged"
            value={`${data?.totals.energy_kwh ?? 0}`}
            unit="kWh"
            chip="MANUAL"
          />
        </View>

        <SectionTitle>Cost summary (30d)</SectionTitle>
        {costs ? (
          <View style={styles.card}>
            <Text style={styles.stat}>
              Total ₹{(costs.total.amount_paise / 100).toFixed(0)} · {costs.total.energy_kwh.toFixed(1)}{' '}
              kWh
            </Text>
            <Text style={styles.meta}>
              Home ₹{(costs.home.amount_paise / 100).toFixed(0)} ({costs.home.count}) · Public ₹
              {(costs.public.amount_paise / 100).toFixed(0)} ({costs.public.count})
            </Text>
            <Chip label="MANUAL" tone="manual" />
          </View>
        ) : (
          <EmptyState title="No costs" body="Log sessions to see spend." />
        )}

        <SectionTitle>Session analytics</SectionTitle>
        {sessionA ? (
          <View style={styles.card}>
            <Text style={styles.stat}>
              Avg {sessionA.avg_power_kw ?? '—'} kW · peak {sessionA.max_power_kw ?? '—'} kW ·{' '}
              {sessionA.duration_min ?? '—'} min
            </Text>
            <Text style={styles.meta}>{sessionA.note}</Text>
            <Chip label={sessionA.data_label === 'manually_entered' ? 'MANUAL' : 'EST.'} tone="manual" />
            {sessionA.power_curve?.length ? (
              <View style={[styles.chart, { marginTop: 10 }]}>
                {sessionA.power_curve.slice(0, 12).map((p, i) => (
                  <View key={i} style={styles.barCol}>
                    <View
                      style={[
                        styles.bar,
                        {
                          height: Math.max(
                            4,
                            (p.power_kw / Math.max(1, sessionA.max_power_kw || 1)) * 100,
                          ),
                        },
                      ]}
                    />
                    <Text style={styles.barLabel}>{Math.round(p.t)}m</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.meta}>
                No dense power series yet — PATCH /sessions/:id/series to add manual curve points.
              </Text>
            )}
          </View>
        ) : (
          <EmptyState title="No session analytics" body="Log a charge session to inspect power metrics." />
        )}

        <SectionTitle>Advanced telemetry analytics</SectionTitle>
        {advanced ? (
          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.stat}>Richness: {advanced.richness}</Text>
              <Chip
                label={
                  advanced.data_label === 'recently_synchronized'
                    ? 'SYNCED'
                    : advanced.data_label === 'manually_entered'
                      ? 'MANUAL'
                      : 'EST.'
                }
                tone={advanced.data_label === 'recently_synchronized' ? 'synced' : 'manual'}
              />
            </View>
            <Text style={styles.meta}>
              Samples {advanced.sample_count} · adapter {advanced.adapter_sample_count} · mean power{' '}
              {advanced.mean_charge_power_kw ?? '—'} kW · peak {advanced.peak_charge_power_kw ?? '—'} kW
            </Text>
            <Text style={styles.meta}>
              Cycles ~{advanced.estimated_cycles ?? '—'} · efficiency trend{' '}
              {advanced.efficiency_trend_kwh_per_100km ?? '—'} kWh/100km · energy/session{' '}
              {advanced.energy_per_session_kwh ?? '—'} kWh
            </Text>
            {advanced.notes.map((n, i) => (
              <Text key={i} style={styles.meta}>
                {n}
              </Text>
            ))}
          </View>
        ) : null}

        <Banner text="Battery health / SOH is not shown — never invent degradation without evidence." />
      </ScrollView>
    </Screen>
  );
}

function Metric({
  label,
  value,
  unit,
  chip,
}: {
  label: string;
  value: string;
  unit?: string;
  chip: string;
}) {
  return (
    <View style={styles.metric}>
      <Text style={styles.meta}>{label}</Text>
      <Text style={styles.metricVal}>
        {value}
        {unit ? <Text style={styles.meta}> {unit}</Text> : null}
      </Text>
      <Chip label={chip} tone="est" />
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing[4], paddingBottom: 48 },
  sub: { fontFamily: fonts.sans, color: colors.textSecondary, marginBottom: 12 },
  label: { fontFamily: fonts.sansMed, color: colors.textSecondary },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    minHeight: 160,
    backgroundColor: colors.bgElevated,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: 12,
    marginBottom: 16,
  },
  barCol: { flex: 1, alignItems: 'center', gap: 4 },
  bar: {
    width: '70%',
    backgroundColor: colors.teal400,
    borderRadius: 4,
  },
  barLabel: { fontFamily: fonts.sans, color: colors.textTertiary, fontSize: 10 },
  barVal: { fontFamily: fonts.mono, color: colors.textSecondary, fontSize: 10 },
  grid: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  metric: {
    flex: 1,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  metricVal: { fontFamily: fonts.monoSemi, color: colors.textPrimary, fontSize: 20 },
  card: {
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: 12,
    padding: 14,
    gap: 8,
    marginBottom: 12,
  },
  stat: { fontFamily: fonts.mono, color: colors.amber400, fontSize: 16 },
  meta: { fontFamily: fonts.sans, color: colors.textTertiary, fontSize: 12 },
});
