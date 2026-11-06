import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../../src/api';
import { Banner, BrandMark, Button, Field, Screen } from '../../src/components';
import { useSession } from '../../src/session';
import { colors, fonts, spacing } from '../../src/theme';

export default function LoginScreen() {
  const { signIn } = useSession();
  const [phone, setPhone] = useState('9876543210');
  const [requestId, setRequestId] = useState<string | null>(null);
  const [code, setCode] = useState('123456');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  async function requestOtp() {
    setError(null);
    setLoading(true);
    try {
      const res = await api<{
        request_id: string;
        demo_hint?: string;
      }>('/auth/otp/request', {
        method: 'POST',
        auth: false,
        body: JSON.stringify({ phone_e164: phone }),
      });
      setRequestId(res.request_id);
      setHint(res.demo_hint || 'OTP sent (stub)');
    } catch (e: any) {
      setError(e.message || 'Failed to request OTP');
    } finally {
      setLoading(false);
    }
  }

  async function verify() {
    if (!requestId) return;
    setError(null);
    setLoading(true);
    try {
      const res = await api<{
        access_token: string;
        user: {
          id: string;
          phone_e164: string;
          role: string;
          display_name?: string;
          is_new?: boolean;
        };
      }>('/auth/otp/verify', {
        method: 'POST',
        auth: false,
        body: JSON.stringify({
          request_id: requestId,
          code,
          device_id: 'expo-web-demo',
        }),
      });
      await signIn(res.access_token, res.user);
    } catch (e: any) {
      setError(e.message || 'OTP verification failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.wrap}>
          <View style={styles.hero}>
            <BrandMark size="lg" />
            <Text style={styles.promise}>Know your real range before you go.</Text>
            <Text style={styles.sub}>
              Phase 1 works with manual SOC — no OEM live data invented.
            </Text>
          </View>

          <Banner
            tone="warn"
            text="Auth uses a secure OTP stub. Demo code: 123456 (SMS provider not configured)."
          />

          {error ? <Banner tone="warn" text={error} /> : null}
          {hint ? <Banner text={hint} /> : null}

          <Field
            label="Mobile (India)"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholder="+91 or 10 digits"
            autoComplete="tel"
          />

          {!requestId ? (
            <Button title="Send OTP" onPress={requestOtp} loading={loading} />
          ) : (
            <View style={{ gap: 12 }}>
              <Field
                label="OTP code"
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                placeholder="6-digit code"
              />
              <Button title="Verify & continue" onPress={verify} loading={loading} />
              <Button title="Resend OTP" variant="ghost" onPress={requestOtp} disabled={loading} />
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingBottom: 48,
    paddingTop: 48,
    gap: 4,
  },
  hero: {
    marginBottom: spacing[6],
    gap: 10,
  },
  promise: {
    fontFamily: fonts.sansSemi,
    color: colors.textPrimary,
    fontSize: 20,
    marginTop: 8,
  },
  sub: {
    fontFamily: fonts.sans,
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
});
