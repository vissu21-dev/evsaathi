import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../../src/api';
import { Banner, Button, Chip, Field, Screen, SectionTitle } from '../../src/components';
import { useSession } from '../../src/session';
import { colors, fonts, spacing } from '../../src/theme';

type PlanResult = {
  distance_km: number;
  energy_kwh_est: number;
  dest_soc_percent: number;
  confidence: number;
  safety_reserve_percent: number;
  disclaimer: string;
  provider: string;
  provider_banner?: string;
  data_label: string;
  stops: Array<{
    seq: number;
    name: string;
    is_demo?: boolean;
    soc_arrive: number;
    soc_depart: number;
    charge_kwh_est: number;
    dwell_min: number;
    cost_paise_est: number;
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

export default function TripsScreen() {
  const { vehicleId } = useSession();
  const [soc, setSoc] = useState('70');
  const [target, setTarget] = useState('20');
  const [preset, setPreset] = useState(0);
  const [result, setResult] = useState<PlanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function plan() {
    if (!vehicleId) return;
    setLoading(true);
    setError(null);
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
          strategy: 'fastest',
        }),
      });
      setResult(res);
    } catch (e: any) {
      setError(e.message || 'Trip plan failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen style={{ paddingHorizontal: 0 }}>
      <ScrollView contentContainerStyle={styles.pad}>
        <SectionTitle>Trip planner</SectionTitle>
        <Text style={styles.sub}>Basic Phase 1 planner — estimates + confidence, never a guarantee.</Text>

        <Banner text="No Maps API key configured → heuristic road distance (haversine × 1.25)." />
        {error ? <Banner tone="warn" text={error} /> : null}

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
              <Text style={styles.cardTitle}>Result</Text>
              <Chip label="EST." tone="est" />
            </View>
            {result.provider_banner ? <Banner tone="warn" text={result.provider_banner} /> : null}
            <Text style={styles.stat}>
              {result.distance_km} km · {result.energy_kwh_est} kWh · dest SOC{' '}
              {result.dest_soc_percent}%
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
                  </View>
                ))}
              </View>
            ) : (
              <Text style={[styles.meta, { marginTop: 8 }]}>
                No charge stop needed under current assumptions.
              </Text>
            )}
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
  cardTitle: { fontFamily: fonts.sansSemi, color: colors.textPrimary },
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
