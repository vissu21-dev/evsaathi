import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api } from '../src/api';
import {
  Banner,
  Button,
  Chip,
  LoadingBlock,
  Screen,
  SectionTitle,
} from '../src/components';
import { useSession } from '../src/session';
import { colors, fonts, spacing } from '../src/theme';

type AdapterCat = {
  vehicle: Array<{ id: string; display_name: string; mode: string; note: string }>;
  operator: Array<{ id: string; display_name: string; mode: string; note: string }>;
  defaults: { oem: string; operator: string };
};

type Consent = {
  id: string;
  adapter_id: string;
  purpose: string;
  granted: boolean;
  policy_version: string;
};

type SyncResult = {
  data_label?: string;
  freshness?: string;
  live_claim?: boolean;
  note?: string;
  degraded?: boolean;
  reason?: string;
  observation?: { soc_percent: number };
};

type LiveSession = {
  available: boolean;
  reason?: string;
  session?: {
    energy_kwh: number | null;
    power_kw: number | null;
    soc_percent: number | null;
    provenance: { note?: string; mode: string };
  };
  data_label?: string;
  live_claim?: boolean;
  note?: string;
};

export default function IntegrationsScreen() {
  const { vehicleId } = useSession();
  const [cat, setCat] = useState<AdapterCat | null>(null);
  const [consents, setConsents] = useState<Consent[]>([]);
  const [live, setLive] = useState<LiveSession | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setMsg(null);
    try {
      const [a, c] = await Promise.all([
        api<AdapterCat>('/integrations/adapters', { auth: false }),
        api<{ data: Consent[] }>('/integrations/consents'),
      ]);
      setCat(a);
      setConsents(c.data);
      if (vehicleId) {
        const s = await api<LiveSession>(`/vehicles/${vehicleId}/integrations/sessions/live`);
        setLive(s);
      }
    } catch (e: any) {
      setMsg(e.message || 'Failed to load integrations');
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

  async function grant(purpose: 'oem_readonly_telemetry' | 'operator_directory' | 'operator_session_sync') {
    if (!vehicleId || !cat) return;
    setBusy(true);
    setMsg(null);
    try {
      const adapter_id =
        purpose === 'oem_readonly_telemetry' ? cat.defaults.oem : cat.defaults.operator;
      await api('/integrations/consents', {
        method: 'POST',
        body: JSON.stringify({
          adapter_id,
          vehicle_id: vehicleId,
          purpose,
          granted: true,
        }),
      });
      setMsg(`Consent granted for ${purpose} (demo adapter — not LIVE)`);
      await load();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function syncOem() {
    if (!vehicleId) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<SyncResult>(`/vehicles/${vehicleId}/integrations/oem/sync`, {
        method: 'POST',
        body: '{}',
      });
      if (r.degraded) {
        setMsg(`Degraded → manual: ${r.reason}`);
      } else {
        setMsg(
          `Synced demo OEM SOC ${r.observation?.soc_percent}% · ${r.data_label} · ${r.freshness} · live_claim=${r.live_claim}`,
        );
      }
      await load();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function importDemoSession() {
    if (!vehicleId) return;
    setBusy(true);
    try {
      await api(`/vehicles/${vehicleId}/integrations/sessions/import-demo`, {
        method: 'POST',
        body: '{}',
      });
      setMsg('Imported demo operator session (SYNCED — not LIVE)');
      await load();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading && !cat) {
    return (
      <Screen>
        <LoadingBlock />
      </Screen>
    );
  }

  return (
    <Screen style={{ paddingHorizontal: 0 }}>
      <ScrollView
        contentContainerStyle={styles.pad}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.teal400} />}
      >
        <SectionTitle>Integrations</SectionTitle>
        <Text style={styles.sub}>
          Consent-gated demo OEM + operator adapters. Never scrapes Me4U. Never claims LIVE without a real feed.
        </Text>

        <Banner tone="warn" text="Demo / simulated adapters only. LIVE badge requires authorized partnership data." />

        {msg ? <Banner text={msg} /> : null}

        <Text style={styles.h}>Vehicle adapters</Text>
        {cat?.vehicle.map((a) => (
          <View key={a.id} style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.name}>{a.display_name}</Text>
              <Chip label={a.mode.toUpperCase()} tone="demo" />
            </View>
            <Text style={styles.meta}>{a.note}</Text>
          </View>
        ))}

        <Text style={styles.h}>Operator adapters</Text>
        {cat?.operator.map((a) => (
          <View key={a.id} style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.name}>{a.display_name}</Text>
              <Chip label={a.mode.toUpperCase()} tone="demo" />
            </View>
            <Text style={styles.meta}>{a.note}</Text>
          </View>
        ))}

        <Text style={styles.h}>Consent</Text>
        <Button
          title="Grant OEM read-only (demo)"
          onPress={() => grant('oem_readonly_telemetry')}
          loading={busy}
        />
        <Button
          title="Grant operator directory (demo)"
          variant="ghost"
          onPress={() => grant('operator_directory')}
          loading={busy}
        />
        <Button
          title="Grant operator session sync (demo)"
          variant="ghost"
          onPress={() => grant('operator_session_sync')}
          loading={busy}
        />

        {consents.filter((c) => c.granted).map((c) => (
          <Text key={c.id} style={styles.meta}>
            ✓ {c.purpose} · {c.adapter_id} · {c.policy_version}
          </Text>
        ))}

        <Text style={styles.h}>Actions</Text>
        <Button title="Sync demo OEM telemetry" onPress={syncOem} loading={busy} />
        <Button title="Import demo operator session" variant="amber" onPress={importDemoSession} loading={busy} />

        <Text style={styles.h}>Session intelligence</Text>
        {live?.available && live.session ? (
          <View style={styles.card}>
            <Chip label="SYNCED · DEMO" tone="synced" />
            <Text style={styles.name}>
              {live.session.energy_kwh ?? '—'} kWh · {live.session.power_kw ?? '—'} kW · SOC{' '}
              {live.session.soc_percent ?? '—'}%
            </Text>
            <Text style={styles.meta}>{live.note || live.session.provenance.note}</Text>
          </View>
        ) : (
          <Banner text={live?.reason || 'No live session feed — use manual log'} />
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing[4], paddingBottom: 48, gap: 8 },
  sub: { fontFamily: fonts.sans, color: colors.textSecondary, marginBottom: 8 },
  h: {
    fontFamily: fonts.display,
    color: colors.textPrimary,
    fontSize: 16,
    marginTop: 12,
    marginBottom: 4,
  },
  card: {
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    gap: 6,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  name: { fontFamily: fonts.sansSemi, color: colors.textPrimary, flex: 1 },
  meta: { fontFamily: fonts.sans, color: colors.textTertiary, fontSize: 12 },
});
