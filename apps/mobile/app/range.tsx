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
};

export default function RangeScreen() {
  const { vehicleId } = useSession();
  const [soc, setSoc] = useState('70');
  const [eff, setEff] = useState('185');
  const [result, setResult] = useState<RangeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function calc() {
    if (!vehicleId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api<RangeResult>(`/vehicles/${vehicleId}/range`, {
        method: 'POST',
        body: JSON.stringify({
          soc_percent: Number(soc),
          efficiency_wh_per_km: Number(eff),
          safety_reserve_percent: 10,
        }),
      });
      setResult(res);
    } catch (e: any) {
      setError(e.message || 'Range calc failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <ScrollView>
        <Text style={styles.title}>Range calculator</Text>
        <Banner text="Documented estimate model — always labeled EST. Not a live OEM range reading." />
        {error ? <Banner tone="warn" text={error} /> : null}

        <Field label="SOC %" value={soc} onChangeText={setSoc} keyboardType="decimal-pad" />
        <Field
          label="Efficiency Wh/km"
          value={eff}
          onChangeText={setEff}
          keyboardType="decimal-pad"
        />
        <Button title="Calculate" onPress={calc} loading={loading} />

        {result ? (
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.big}>{result.rangeKmWithReserve} km</Text>
              <Chip label="EST." tone="est" />
            </View>
            <Text style={styles.meta}>
              Without reserve {result.rangeKm} km · usable at SOC {result.usableKwhAtSoc} kWh ·{' '}
              {result.kwhPer100Km} kWh/100km · confidence {result.confidence}%
            </Text>
            {result.usable_note ? <Banner text={result.usable_note} /> : null}
            <Text style={styles.label}>Assumptions</Text>
            {result.assumptions.map((a) => (
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
  title: { fontFamily: fonts.sansSemi, color: colors.textPrimary, fontSize: 20, marginBottom: 12 },
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
  big: { fontFamily: fonts.monoSemi, color: colors.teal400, fontSize: 32 },
  meta: { fontFamily: fonts.sans, color: colors.textTertiary, fontSize: 12, lineHeight: 18 },
  label: { fontFamily: fonts.sansSemi, color: colors.textSecondary, marginTop: 8 },
});
