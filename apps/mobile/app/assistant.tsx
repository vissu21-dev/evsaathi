import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../src/api';
import { Banner, Button, Chip, Field, Screen, SectionTitle } from '../src/components';
import { useSession } from '../src/session';
import { colors, fonts, spacing } from '../src/theme';

type Reply = {
  answer: string;
  citations: Array<{ kind: string; data_label?: string; text: string }>;
  tools_used: string[];
  denied_attempts: string[];
  disclaimer: string;
};

const PROMPTS = [
  'What is my battery status and data freshness?',
  'Find nearby demo stations',
  'Estimate energy for a 120 km trip',
  'Please remote start my charger',
  'Unlock my car and turn on climate',
];

export default function AssistantScreen() {
  const { vehicleId } = useSession();
  const [message, setMessage] = useState(PROMPTS[0]);
  const [reply, setReply] = useState<Reply | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(text = message) {
    setBusy(true);
    setError(null);
    try {
      const r = await api<Reply>('/ai/assistant', {
        method: 'POST',
        body: JSON.stringify({ message: text, vehicle_id: vehicleId }),
      });
      setReply(r);
      setMessage(text);
    } catch (e: any) {
      setError(e.message || 'Assistant unavailable');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen style={{ paddingHorizontal: 0 }}>
      <ScrollView contentContainerStyle={styles.pad}>
        <SectionTitle>AI assistant</SectionTitle>
        <Text style={styles.sub}>
          Explainable Q&A over your vehicle, history, and stations. Hard-denies vehicle/charger actuators.
        </Text>
        <Banner tone="warn" text="AI cannot remote-start, unlock, climate, or write OBD/ECU commands." />

        <Field
          label="Ask EVSaathi"
          value={message}
          onChangeText={setMessage}
          multiline
          style={{ minHeight: 72, textAlignVertical: 'top' }}
        />
        <Button title="Ask" onPress={() => ask()} loading={busy} />

        <Text style={styles.h}>Try</Text>
        {PROMPTS.map((p) => (
          <Button key={p} title={p} variant="ghost" onPress={() => ask(p)} disabled={busy} />
        ))}

        {error ? <Banner tone="warn" text={error} /> : null}

        {reply ? (
          <View style={styles.card}>
            <Text style={styles.answer}>{reply.answer}</Text>
            {reply.denied_attempts.length > 0 ? (
              <View style={{ marginTop: 10, gap: 6 }}>
                <Chip label="ACTUATOR DENIED" tone="demo" />
                <Text style={styles.meta}>Blocked: {reply.denied_attempts.join(', ')}</Text>
              </View>
            ) : null}
            <Text style={styles.h}>Tools used</Text>
            <Text style={styles.meta}>{reply.tools_used.join(', ') || 'none'}</Text>
            <Text style={styles.h}>Citations</Text>
            {reply.citations.map((c, i) => (
              <Text key={i} style={styles.meta}>
                [{c.kind}{c.data_label ? ` · ${c.data_label}` : ''}] {c.text}
              </Text>
            ))}
            <Banner text={reply.disclaimer} />
          </View>
        ) : null}
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
    fontSize: 15,
    marginTop: 12,
    marginBottom: 4,
  },
  card: {
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
    gap: 6,
  },
  answer: { fontFamily: fonts.sans, color: colors.textPrimary, lineHeight: 22 },
  meta: { fontFamily: fonts.sans, color: colors.textTertiary, fontSize: 12, lineHeight: 18 },
});
