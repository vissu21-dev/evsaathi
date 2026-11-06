import { useEffect, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { api } from '../../src/api';
import { Banner, Button, Chip, LoadingBlock, Screen } from '../../src/components';
import { colors, fonts, spacing } from '../../src/theme';

type Detail = {
  id: string;
  name: string;
  address: { line?: string; city?: string; state?: string };
  location: { lat: number; lng: number };
  amenities: string[];
  is_open_24x7: boolean;
  connectors: {
    type: string;
    power_kw: number;
    current_type: string;
    status_note: string;
  }[];
  tariffs: { energy_rate_paise: number; data_label: string; note?: string }[];
  reliability: null;
  reliability_note: string;
  nav: { google_maps: string };
  is_demo: boolean;
};

export default function StationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const d = await api<Detail>(`/stations/${id}`, { auth: false });
        setData(d);
      } catch (e: any) {
        setError(e.message || 'Station not found');
      }
    })();
  }, [id]);

  if (error) {
    return (
      <Screen>
        <Banner tone="warn" text={error} />
      </Screen>
    );
  }
  if (!data) {
    return (
      <Screen>
        <LoadingBlock />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={styles.row}>
          <Text style={styles.title}>{data.name}</Text>
          {data.is_demo ? <Chip label="DEMO" tone="demo" /> : null}
        </View>
        {data.is_demo ? (
          <Banner tone="warn" text="Demo station — not live operator availability or verified prices." />
        ) : null}

        <Text style={styles.meta}>
          {[data.address.line, data.address.city, data.address.state].filter(Boolean).join(', ')}
        </Text>
        <Text style={styles.meta}>
          {data.is_open_24x7 ? 'Open 24×7' : 'Limited hours'} · amenities{' '}
          {data.amenities.join(', ') || '—'}
        </Text>

        <Text style={styles.section}>Connectors</Text>
        {data.connectors.map((c, i) => (
          <View key={i} style={styles.card}>
            <Text style={styles.cardTitle}>
              {c.type} · {c.power_kw} kW · {c.current_type.toUpperCase()}
            </Text>
            <Text style={styles.meta}>{c.status_note}</Text>
          </View>
        ))}

        <Text style={styles.section}>Tariffs</Text>
        {data.tariffs.map((t, i) => (
          <View key={i} style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.cardTitle}>₹{(t.energy_rate_paise / 100).toFixed(0)}/kWh</Text>
              <Chip label="MANUAL/DEMO" tone="manual" />
            </View>
            {t.note ? <Text style={styles.meta}>{t.note}</Text> : null}
          </View>
        ))}

        <Text style={styles.section}>Reliability</Text>
        <Banner text={data.reliability_note} />

        <Button title="Open in Google Maps" onPress={() => Linking.openURL(data.nav.google_maps)} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' },
  title: {
    fontFamily: fonts.display,
    color: colors.textPrimary,
    fontSize: 22,
    flex: 1,
    marginBottom: 8,
  },
  meta: { fontFamily: fonts.sans, color: colors.textTertiary, fontSize: 13, marginBottom: 4 },
  section: {
    fontFamily: fonts.sansSemi,
    color: colors.textPrimary,
    marginTop: spacing[4],
    marginBottom: 8,
  },
  card: {
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgElevated,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    gap: 4,
  },
  cardTitle: { fontFamily: fonts.sansSemi, color: colors.textPrimary },
});
