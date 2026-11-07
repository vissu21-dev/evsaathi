import { useCallback, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '../../src/api';
import { Banner, Button, Chip, Field, LoadingBlock, Screen } from '../../src/components';
import { colors, fonts, spacing } from '../../src/theme';

type Reliability = {
  score: number | null;
  confidence: number | null;
  last_verified_at?: string | null;
  quarantined?: boolean;
  provenance?: string;
  note?: string;
};

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
  reliability: Reliability | null;
  last_verified_at: string | null;
  verification_note?: string;
  nav: { google_maps: string };
  is_demo: boolean;
};

type Report = {
  id: string;
  category: string;
  severity: string;
  description?: string | null;
  reported_at: string;
  status: string;
};

type Alt = {
  id: string;
  name: string;
  distance_m: number;
  reliability: Reliability;
  last_verified_at: string | null;
  is_demo: boolean;
};

const REPORT_OPTS = [
  { id: 'working', label: 'Working' },
  { id: 'charger_dead', label: 'Not working' },
  { id: 'started_failed', label: 'Session failed' },
  { id: 'payment_failed', label: 'Payment fail' },
  { id: 'power_low', label: 'Low power' },
  { id: 'connector_damaged', label: 'Damaged' },
  { id: 'inaccessible', label: 'Inaccessible' },
  { id: 'queue', label: 'Queue' },
  { id: 'safety_cleanliness', label: 'Safety/clean' },
] as const;

function timeAgo(iso: string | null | undefined) {
  if (!iso) return 'Never verified';
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.round(ms / 3600000);
  if (h < 1) return 'Verified <1h ago';
  if (h < 48) return `Verified ${h}h ago`;
  return `Verified ${Math.round(h / 24)}d ago`;
}

export default function StationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<Detail | null>(null);
  const [reliability, setReliability] = useState<any>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [alts, setAlts] = useState<Alt[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<(typeof REPORT_OPTS)[number]['id']>('working');
  const [note, setNote] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [d, rel, rep, alt] = await Promise.all([
        api<Detail>(`/stations/${id}`, { auth: false }),
        api<any>(`/stations/${id}/reliability`, { auth: false }),
        api<{ data: Report[] }>(`/stations/${id}/failure-reports`, { auth: false }),
        api<{ data: Alt[] }>(`/stations/${id}/alternatives?limit=5`, { auth: false }),
      ]);
      setData(d);
      setReliability(rel);
      setReports(rep.data);
      setAlts(alt.data);
      setError(null);
    } catch (e: any) {
      setError(e.message || 'Station not found');
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function submitReport() {
    setSubmitting(true);
    setMsg(null);
    try {
      const media = photoUrl.trim() ? [photoUrl.trim()] : [];
      await api(`/stations/${id}/failure-reports`, {
        method: 'POST',
        body: JSON.stringify({
          category,
          severity: category === 'working' ? 'low' : category === 'charger_dead' ? 'high' : 'medium',
          description: note || undefined,
          media_urls: media,
        }),
      });
      setMsg('Report submitted (crowdsource — rate-limited). Not operator telemetry.');
      setNote('');
      setPhotoUrl('');
      await load();
    } catch (e: any) {
      setMsg(e.message || 'Report failed');
    } finally {
      setSubmitting(false);
    }
  }

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

  const score = reliability?.score ?? data.reliability?.score;
  const confidence = reliability?.confidence ?? data.reliability?.confidence ?? 0;
  const verified = data.last_verified_at ?? reliability?.last_verified_at;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
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

        <Text style={styles.section}>Reliability (crowdsource)</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.score}>
              {reliability?.display === 'insufficient_data' || score == null ? '—' : score}
            </Text>
            <View style={{ flex: 1, gap: 4 }}>
              <Chip label="CROWD ≠ LIVE" tone="est" />
              <Text style={styles.meta}>
                {reliability?.display === 'insufficient_data'
                  ? 'Insufficient data (confidence < 25)'
                  : `Confidence ${confidence}%`}
              </Text>
              <Text style={styles.verify}>{timeAgo(verified)}</Text>
            </View>
          </View>
          {reliability?.sample_sizes ? (
            <Text style={styles.meta}>
              Samples 30d: {reliability.sample_sizes.crowd_30d} · open failures:{' '}
              {reliability.sample_sizes.open_failures} · reviews:{' '}
              {reliability.sample_sizes.reviews}
            </Text>
          ) : null}
          <Text style={styles.meta}>
            {data.verification_note ||
              'Last verified = trusted crowd/admin check — not OEM/operator live ping'}
          </Text>
        </View>

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

        <Text style={styles.section}>Recent owner reports</Text>
        {!reports.length ? (
          <Banner text="No crowd reports yet for this station." />
        ) : (
          reports.slice(0, 6).map((r) => (
            <View key={r.id} style={styles.card}>
              <Text style={styles.cardTitle}>
                {r.category.replace(/_/g, ' ')} · {r.severity}
              </Text>
              <Text style={styles.meta}>
                {new Date(r.reported_at).toLocaleString('en-IN')} · {r.status}
              </Text>
              {r.description ? <Text style={styles.meta}>{r.description}</Text> : null}
            </View>
          ))
        )}

        <Text style={styles.section}>Report status</Text>
        <View style={styles.pills}>
          {REPORT_OPTS.map((o) => (
            <Pressable
              key={o.id}
              onPress={() => setCategory(o.id)}
              style={[styles.pill, category === o.id && styles.pillOn]}
            >
              <Text style={[styles.pillText, category === o.id && styles.pillTextOn]}>{o.label}</Text>
            </Pressable>
          ))}
        </View>
        <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder="What happened?" />
        <Field
          label="Photo URL (optional)"
          value={photoUrl}
          onChangeText={setPhotoUrl}
          placeholder="https://… or leave blank"
          autoCapitalize="none"
        />
        {msg ? <Banner tone={msg.includes('submitted') ? 'info' : 'warn'} text={msg} /> : null}
        <Button title="Submit report" onPress={submitReport} loading={submitting} />

        <Text style={styles.section}>Alternative chargers</Text>
        {!alts.length ? (
          <Banner text="No compatible alternatives within 80 km." />
        ) : (
          alts.map((a) => (
            <Pressable key={a.id} style={styles.card} onPress={() => router.push(`/stations/${a.id}`)}>
              <View style={styles.row}>
                <Text style={styles.cardTitle}>{a.name}</Text>
                {a.is_demo ? <Chip label="DEMO" tone="demo" /> : null}
              </View>
              <Text style={styles.meta}>
                {(a.distance_m / 1000).toFixed(1)} km · score {a.reliability?.score ?? '—'} ·{' '}
                {timeAgo(a.last_verified_at)}
              </Text>
            </Pressable>
          ))
        )}

        <View style={{ height: 12 }} />
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
  verify: { fontFamily: fonts.sansSemi, color: colors.teal400, fontSize: 13 },
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
  score: {
    fontFamily: fonts.monoSemi,
    color: colors.teal400,
    fontSize: 42,
    lineHeight: 46,
    minWidth: 72,
  },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  pill: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  pillOn: { borderColor: colors.teal400, backgroundColor: 'rgba(46,230,166,0.1)' },
  pillText: { fontFamily: fonts.sansSemi, color: colors.textTertiary, fontSize: 11 },
  pillTextOn: { color: colors.teal400 },
});
