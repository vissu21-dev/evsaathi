import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../../src/api';
import { Banner, Button, Chip, Field, Screen, SectionTitle } from '../../src/components';
import { useSession } from '../../src/session';
import { colors, fonts, spacing } from '../../src/theme';

type Strategy = 'fastest' | 'lowest_cost' | 'most_reliable';

type PlanResult = {
  route_plan_id: string;
  distance_km: number;
  duration_min: number;
  energy_kwh_est: number;
  dest_soc_percent: number;
  confidence: number;
  safety_reserve_percent: number;
  disclaimer: string;
  provider: string;
  provider_banner?: string;
  data_label: string;
  strategy: Strategy;
  stops: Array<{
    seq: number;
    name: string;
    is_demo?: boolean;
    soc_arrive: number;
    soc_depart: number;
    charge_kwh_est: number;
    dwell_min: number;
    cost_paise_est: number;
    rank_reason?: string;
    reliability?: { score: number | null; confidence: number | null };
    last_verified_at?: string | null;
  }>;
  alternatives: Array<{
    strategy: string;
    name: string;
    rank_reason?: string;
    reliability_score?: number | null;
    energy_rate_paise?: number;
    max_power_kw?: number;
  }>;
};

const PRESETS = [
  {
    label: 'Mumbai → Pune',
    origin: { lat: 19.076, lng: 72.877, label: 'Mumbai' },
    destination: { lat: 18.52, lng: 73.856, label: 'Pune' },
  },
  {
    label: 'Delhi → Gurugram',
    origin: { lat: 28.613, lng: 77.209, label: 'New Delhi' },
    destination: { lat: 28.459, lng: 77.026, label: 'Gurugram' },
  },
];

const STRATEGIES: { id: Strategy; label: string }[] = [
  { id: 'fastest', label: 'Fastest' },
  { id: 'lowest_cost', label: 'Lowest cost' },
  { id: 'most_reliable', label: 'Most reliable' },
];

export default function TripsScreen() {
  const { vehicleId } = useSession();
  const [soc, setSoc] = useState('70');
  const [target, setTarget] = useState('20');
  const [preset, setPreset] = useState(0);
  const [strategy, setStrategy] = useState<Strategy>('fastest');
  const [result, setResult] = useState<PlanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [recalcMsg, setRecalcMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function plan() {
    if (!vehicleId) return;
    setLoading(true);
    setError(null);
    setRecalcMsg(null);
    try {
      const p = PRESETS[preset];
      const res = await api<PlanResult>('/trips/plan', {
        method: 'POST',
        body: JSON.stringify({
          vehicle_id: vehicleId,
          origin: p.origin,
          destination: p.destination,
          soc_start_percent: Number(soc),
          target_soc_arrival_percent: Number(target),
          cabin_ac: true,
          strategy,
        }),
      });
      setResult(res);
    } catch (e: any) {
      setError(e.message || 'Trip plan failed');
    } finally {
      setLoading(false);
    }
  }

  async function recalculate() {
    if (!result?.route_plan_id) return;
    setLoading(true);
    try {
      const r = await api<{
        note: string;
        failed_station_ids: string[];
        stops: PlanResult['stops'];
        alternatives: unknown[];
      }>(`/trips/plans/${result.route_plan_id}/recalculate`, { method: 'POST' });
      setRecalcMsg(r.note);
      setResult({
        ...result,
        stops: r.stops as PlanResult['stops'],
        alternatives: (r.alternatives as PlanResult['alternatives']) || result.alternatives,
      });
    } catch (e: any) {
      setError(e.message || 'Recalculate failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen style={{ paddingHorizontal: 0 }}>
      <ScrollView contentContainerStyle={styles.pad}>
        <SectionTitle>Trip planner</SectionTitle>
        <Text style={styles.sub}>
          Phase 2 strategies — Fastest / Lowest cost / Most reliable. Estimates + confidence, never a
          guarantee.
        </Text>

        <Banner text="No Maps API key → heuristic road distance (haversine × 1.25). Reliability is crowdsource, not operator telemetry." />
        {error ? <Banner tone="warn" text={error} /> : null}
        {recalcMsg ? <Banner text={recalcMsg} /> : null}

        <Text style={styles.label}>Route preset</Text>
        <View style={styles.row}>
          {PRESETS.map((p, i) => (
            <Button
              key={p.label}
              title={p.label}
              variant={preset === i ? 'primary' : 'ghost'}
              onPress={() => setPreset(i)}
            />
          ))}
        </View>

        <Text style={styles.label}>Strategy</Text>
        <View style={styles.row}>
          {STRATEGIES.map((s) => (
            <Button
              key={s.id}
              title={s.label}
              variant={strategy === s.id ? 'primary' : 'ghost'}
              onPress={() => setStrategy(s.id)}
            />
          ))}
        </View>

        <Field label="Start SOC %" value={soc} onChangeText={setSoc} keyboardType="decimal-pad" />
        <Field
          label="Target arrival SOC %"
          value={target}
          onChangeText={setTarget}
          keyboardType="decimal-pad"
        />
        <Button title="Plan trip" onPress={plan} loading={loading} />

        {result ? (
          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>Result · {result.strategy.replace(/_/g, ' ')}</Text>
              <Chip label="EST." tone="est" />
            </View>
            {result.provider_banner ? <Banner tone="warn" text={result.provider_banner} /> : null}
            <Text style={styles.stat}>
              {result.distance_km} km · ~{result.duration_min} min · {result.energy_kwh_est} kWh · dest
              SOC {result.dest_soc_percent}%
            </Text>
            <Text style={styles.meta}>
              Confidence {result.confidence}% · safety reserve {result.safety_reserve_percent}% ·
              provider {result.provider}
            </Text>
            <Text style={styles.disclaimer}>{result.disclaimer}</Text>

            {result.stops.length ? (
              <View style={{ gap: 8, marginTop: 12 }}>
                <Text style={styles.label}>Suggested charge stops</Text>
                {result.stops.map((s) => (
                  <View key={s.seq} style={styles.stop}>
                    <View style={styles.rowBetween}>
                      <Text style={styles.cardTitle}>
                        {s.seq}. {s.name}
                      </Text>
                      {s.is_demo ? <Chip label="DEMO" tone="demo" /> : null}
                    </View>
                    <Text style={styles.meta}>
                      Arrive {s.soc_arrive}% → depart {s.soc_depart}% · {s.charge_kwh_est} kWh · ~
                      {s.dwell_min} min · ₹{(s.cost_paise_est / 100).toFixed(0)}
                    </Text>
                    {s.reliability ? (
                      <Text style={styles.meta}>
                        Reliability {s.reliability.score ?? '—'} (conf {s.reliability.confidence ?? '—'}
                        %) · crowdsource
                      </Text>
                    ) : null}
                    {s.rank_reason ? <Text style={styles.meta}>{s.rank_reason}</Text> : null}
                  </View>
                ))}
              </View>
            ) : (
              <Text style={[styles.meta, { marginTop: 8 }]}>
                No charge stop needed under current assumptions.
              </Text>
            )}

            {result.alternatives?.length ? (
              <View style={{ gap: 6, marginTop: 12 }}>
                <Text style={styles.label}>Alternatives (other strategies)</Text>
                {result.alternatives.map((a, i) => (
                  <Text key={i} style={styles.meta}>
                    {a.strategy.replace(/_/g, ' ')}: {a.name}
                    {a.reliability_score != null ? ` · score ${a.reliability_score}` : ''}
                    {a.energy_rate_paise != null
                      ? ` · ₹${(a.energy_rate_paise / 100).toFixed(0)}/kWh`
                      : ''}
                    {a.max_power_kw != null ? ` · ${a.max_power_kw} kW` : ''}
                  </Text>
                ))}
              </View>
            ) : null}

            <View style={{ marginTop: 12 }}>
              <Button title="Recalculate if stop failed" variant="amber" onPress={recalculate} />
            </View>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing[4], paddingBottom: 48, gap: 4 },
  sub: { fontFamily: fonts.sans, color: colors.textSecondary, marginBottom: 12 },
  label: { fontFamily: fonts.sansMed, color: colors.textSecondary, marginBottom: 8 },
  row: { gap: 8, marginBottom: 12 },
  card: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgElevated,
    borderRadius: 12,
    padding: 14,
    gap: 6,
  },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontFamily: fonts.sansSemi, color: colors.textPrimary, flex: 1 },
  stat: { fontFamily: fonts.mono, color: colors.teal400, fontSize: 15, marginTop: 8 },
  meta: { fontFamily: fonts.sans, color: colors.textTertiary, fontSize: 12 },
  disclaimer: { fontFamily: fonts.sans, color: colors.amber400, fontSize: 12, marginTop: 6 },
  stop: {
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    paddingTop: 8,
    gap: 4,
  },
});
