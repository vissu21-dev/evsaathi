import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { api } from '../src/api';
import { Banner, Button, Chip, Field, Screen } from '../src/components';
import { useSession } from '../src/session';
import { colors, fonts, spacing } from '../src/theme';

type Station = { id: string; name: string; is_demo: boolean };

export default function LogSessionScreen() {
  const { vehicleId } = useSession();
  const router = useRouter();
  const [stations, setStations] = useState<Station[]>([]);
  const [stationId, setStationId] = useState<string | null>(null);
  const [isHome, setIsHome] = useState(false);
  const [socStart, setSocStart] = useState('20');
  const [socEnd, setSocEnd] = useState('80');
  const [energy, setEnergy] = useState('');
  const [rate, setRate] = useState('18');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await api<{ data: Station[] }>('/stations/search?lat=19.076&lng=72.877&radius_m=500000', {
        auth: false,
      });
      setStations(res.data.slice(0, 8));
    })().catch(() => undefined);
  }, []);

  async function previewCost() {
    const energyKwh = energy ? Number(energy) : undefined;
    if (!energyKwh) {
      setPreview('Enter energy kWh for preview, or leave blank to derive from SOC delta × usable pack.');
      return;
    }
    try {
      const c = await api<{ totalCostInr: number; data_label: string }>('/costs/estimate', {
        method: 'POST',
        body: JSON.stringify({
          energy_kwh: energyKwh,
          rate_paise_per_kwh: Math.round(Number(rate) * 100),
          loss_factor: isHome ? 1.08 : 1,
        }),
      });
      setPreview(`Estimated ₹${c.totalCostInr} (${c.data_label})`);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function save() {
    if (!vehicleId) return;
    setLoading(true);
    setError(null);
    try {
      await api('/sessions', {
        method: 'POST',
        body: JSON.stringify({
          vehicle_id: vehicleId,
          station_id: isHome ? null : stationId,
          soc_start: Number(socStart),
          soc_end: Number(socEnd),
          energy_kwh: energy ? Number(energy) : undefined,
          rate_paise_per_kwh: Math.round(Number(rate) * 100),
          is_home: isHome,
        }),
      });
      router.back();
    } catch (e: any) {
      setError(e.message || 'Could not save session');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <Text style={styles.title}>Log charging session</Text>
        <Banner text="Manual session — labeled MANUAL. Costs are calculated estimates." />
        {error ? <Banner tone="warn" text={error} /> : null}
        {preview ? <Banner text={preview} /> : null}

        <View style={styles.row}>
          <Button
            title={isHome ? 'Home charge ✓' : 'Mark as home'}
            variant={isHome ? 'amber' : 'ghost'}
            onPress={() => {
              setIsHome(!isHome);
              if (!isHome) setStationId(null);
            }}
          />
        </View>

        {!isHome ? (
          <View style={{ gap: 8, marginBottom: 12 }}>
            <Text style={styles.label}>Station (demo OK)</Text>
            {stations.map((s) => (
              <Pressable
                key={s.id}
                onPress={() => setStationId(s.id)}
                style={[styles.card, stationId === s.id && styles.cardOn]}
              >
                <View style={styles.rowBetween}>
                  <Text style={styles.cardTitle}>{s.name}</Text>
                  {s.is_demo ? <Chip label="DEMO" tone="demo" /> : null}
                </View>
              </Pressable>
            ))}
          </View>
        ) : null}

        <Field label="SOC start %" value={socStart} onChangeText={setSocStart} keyboardType="decimal-pad" />
        <Field label="SOC end %" value={socEnd} onChangeText={setSocEnd} keyboardType="decimal-pad" />
        <Field
          label="Energy kWh (optional)"
          value={energy}
          onChangeText={setEnergy}
          keyboardType="decimal-pad"
          placeholder="Derived from SOC if empty"
        />
        <Field
          label="Rate ₹/kWh"
          value={rate}
          onChangeText={setRate}
          keyboardType="decimal-pad"
        />

        <View style={{ gap: 10 }}>
          <Button title="Preview cost" variant="ghost" onPress={previewCost} />
          <Button title="Save session" onPress={save} loading={loading} />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.sansSemi, color: colors.textPrimary, fontSize: 20, marginBottom: 12 },
  label: { fontFamily: fonts.sansMed, color: colors.textSecondary, marginBottom: 8 },
  row: { marginBottom: 12 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  card: {
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgElevated,
    borderRadius: 10,
    padding: 12,
  },
  cardOn: { borderColor: colors.teal400 },
  cardTitle: { fontFamily: fonts.sansSemi, color: colors.textPrimary, flex: 1, fontSize: 13 },
});
