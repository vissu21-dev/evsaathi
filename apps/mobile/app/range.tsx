import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../src/api';
import { Banner, Button, Chip, Field, Screen } from '../src/components';
import { useSession } from '../src/session';
import { colors, fonts } from '../src/theme';

type RangeResult = {
  rangeKm: number;
  rangeKmWithReserve: number;
  usableKwhAtSoc: number;
  kwhPer100Km: number;
  confidence: number;
  assumptions: string[];
  data_label: string;
  usable_note?: string;
  efficiency_model?: {
    efficiencyWhPerKm: number;
    catalogWhPerKm: number;
    historyWhPerKm: number | null;
    historyWeight: number;
    sampleCount: number;
    sampleDistanceKm: number;
  };
  model?: string;
};

export default function RangeScreen() {
  const { vehicleId } = useSession();
  const [soc, setSoc] = useState('70');
  const [eff, setEff] = useState('185');
  const [result, setResult] = useState<RangeResult | null>(null);
  const [advanced, setAdvanced] = useState<RangeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function calc() {
    if (!vehicleId) return;
    setLoading(true);
    setError(null);
    try {
      const [basic, hist] = await Promise.all([
        api<RangeResult>(`/vehicles/${vehicleId}/range`, {
          method: 'POST',
          body: JSON.stringify({
            soc_percent: Number(soc),
            efficiency_wh_per_km: Number(eff),
            safety_reserve_percent: 10,
          }),
        }),
        api<RangeResult>(`/vehicles/${vehicleId}/range/advanced`, {
          method: 'POST',
          body: JSON.stringify({
            soc_percent: Number(soc),
            safety_reserve_percent: 10,
          }),
        }),
      ]);
      setResult(basic);
      setAdvanced(hist);
    } catch (e: any) {
      setError(e.message || 'Range calc failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <Text style={styles.title}>Range calculator</Text>
        <Banner text="Phase 2: catalog estimate + history-weighted blend. Always EST. — not live OEM range." />
        {error ? <Banner tone="warn" text={error} /> : null}

        <Field label="SOC %" value={soc} onChangeText={setSoc} keyboardType="decimal-pad" />
        <Field
          label="Catalog efficiency Wh/km (basic)"
          value={eff}
          onChangeText={setEff}
          keyboardType="decimal-pad"
        />
        <Button title="Calculate" onPress={calc} loading={loading} />

        {result ? (
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.label}>Basic (catalog)</Text>
              <Chip label="EST." tone="est" />
            </View>
            <Text style={styles.big}>{result.rangeKmWithReserve} km</Text>
            <Text style={styles.meta}>
              Without reserve {result.rangeKm} km · usable {result.usableKwhAtSoc} kWh · confidence{' '}
              {result.confidence}%
            </Text>
          </View>
        ) : null}

        {advanced ? (
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.label}>History-weighted (P2)</Text>
              <Chip label="EST." tone="est" />
            </View>
            <Text style={styles.big}>{advanced.rangeKmWithReserve} km</Text>
            <Text style={styles.meta}>
              Without reserve {advanced.rangeKm} km · confidence {advanced.confidence}%
            </Text>
            {advanced.efficiency_model ? (
              <Text style={styles.meta}>
                Blend {advanced.efficiency_model.efficiencyWhPerKm} Wh/km (catalog{' '}
                {advanced.efficiency_model.catalogWhPerKm}
                {advanced.efficiency_model.historyWhPerKm != null
                  ? ` · history ${advanced.efficiency_model.historyWhPerKm}`
                  : ' · no history yet'}
                ) · weight {advanced.efficiency_model.historyWeight} · samples{' '}
                {advanced.efficiency_model.sampleCount} ({advanced.efficiency_model.sampleDistanceKm}{' '}
                km)
              </Text>
            ) : null}
            <Text style={styles.label}>Assumptions</Text>
            {advanced.assumptions.map((a) => (
              <Text key={a} style={styles.meta}>
                · {a}
              </Text>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: fonts.display,
    color: colors.textPrimary,
    fontSize: 24,
    marginBottom: 12,
  },
  card: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgElevated,
    borderRadius: 12,
    padding: 14,
    gap: 6,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  big: { fontFamily: fonts.monoSemi, color: colors.teal400, fontSize: 36 },
  label: { fontFamily: fonts.sansSemi, color: colors.textPrimary, marginTop: 8 },
  meta: { fontFamily: fonts.sans, color: colors.textTertiary, fontSize: 12 },
});
