import { useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { api } from '../src/api';
import { Banner, Button, Field, Screen } from '../src/components';
import { useSession } from '../src/session';
import { colors, fonts } from '../src/theme';

export default function LogSocScreen() {
  const { vehicleId } = useSession();
  const router = useRouter();
  const [soc, setSoc] = useState('65');
  const [odo, setOdo] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function save() {
    if (!vehicleId) return;
    const n = Number(soc);
    if (Number.isNaN(n) || n < 0 || n > 100) {
      setError('SOC must be 0–100');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await api(`/vehicles/${vehicleId}/telemetry`, {
        method: 'POST',
        body: JSON.stringify({
          soc_percent: n,
          odometer_km: odo ? Number(odo) : undefined,
          source: 'manual',
        }),
      });
      setOk('SOC saved as MANUAL');
      setTimeout(() => router.back(), 600);
    } catch (e: any) {
      setError(e.message || 'Save failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <ScrollView>
        <Text style={styles.title}>Manual SOC entry</Text>
        <Banner text="Labeled MANUAL — not live OEM telemetry." />
        {error ? <Banner tone="warn" text={error} /> : null}
        {ok ? <Banner text={ok} /> : null}
        <Field label="SOC %" value={soc} onChangeText={setSoc} keyboardType="decimal-pad" />
        <Field
          label="Odometer km (optional, improves consumption)"
          value={odo}
          onChangeText={setOdo}
          keyboardType="decimal-pad"
        />
        <Button title="Save SOC" onPress={save} loading={loading} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: fonts.sansSemi,
    color: colors.textPrimary,
    fontSize: 20,
    marginBottom: 12,
  },
});
