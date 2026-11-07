import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api } from '../src/api';
import { Banner, Button, Chip, EmptyState, LoadingBlock, Screen, SectionTitle } from '../src/components';
import { colors, fonts, spacing } from '../src/theme';

type Notif = {
  id: string;
  channel: string;
  type: string;
  title: string;
  body: string;
  status: string;
  created_at: string;
  read_at: string | null;
};

export default function NotificationsScreen() {
  const [rows, setRows] = useState<Notif[]>([]);
  const [delivery, setDelivery] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api<{
        data: Notif[];
        delivery: { mode: string; note: string };
      }>('/notifications');
      setRows(res.data);
      setDelivery(`${res.delivery.mode}: ${res.delivery.note}`);
    } catch (e: any) {
      setError(e.message || 'Failed to load notifications');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load]),
  );

  async function markRead(id: string) {
    await api(`/notifications/${id}/read`, { method: 'POST' });
    await load();
  }

  async function markAll() {
    await api('/notifications/read-all', { method: 'POST' });
    await load();
  }

  async function demo(type: string) {
    await api('/notifications/demo', {
      method: 'POST',
      body: JSON.stringify({ type }),
    });
    await load();
  }

  if (loading && !rows.length) {
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
        <SectionTitle>Notifications</SectionTitle>
        <Text style={styles.sub}>In-app inbox (FCM only if server keys exist).</Text>
        {delivery ? <Banner text={delivery} /> : null}
        {error ? <Banner tone="warn" text={error} /> : null}

        <View style={styles.row}>
          <Button title="Mark all read" variant="ghost" onPress={markAll} />
          <Button title="Demo low battery" onPress={() => demo('low_battery')} />
        </View>

        {!rows.length ? (
          <EmptyState
            title="Inbox empty"
            body="Charge events, low range, and station failure alerts appear here."
          />
        ) : (
          <View style={{ gap: 8 }}>
            {rows.map((n) => (
              <Pressable key={n.id} style={styles.card} onPress={() => markRead(n.id)}>
                <View style={styles.rowBetween}>
                  <Text style={styles.title}>{n.title}</Text>
                  <Chip
                    label={n.status === 'read' ? 'READ' : n.channel.toUpperCase()}
                    tone={n.status === 'read' ? 'synced' : 'manual'}
                  />
                </View>
                <Text style={styles.body}>{n.body}</Text>
                <Text style={styles.meta}>
                  {n.type} · {new Date(n.created_at).toLocaleString('en-IN')}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing[4], paddingBottom: 48 },
  sub: { fontFamily: fonts.sans, color: colors.textSecondary, marginBottom: 12 },
  row: { gap: 8, marginBottom: 12 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  card: {
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgElevated,
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  title: { fontFamily: fonts.sansSemi, color: colors.textPrimary, flex: 1 },
  body: { fontFamily: fonts.sans, color: colors.textSecondary, fontSize: 13 },
  meta: { fontFamily: fonts.sans, color: colors.textTertiary, fontSize: 11 },
});
