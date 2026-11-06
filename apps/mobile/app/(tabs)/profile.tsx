import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Banner, BrandMark, Button, Chip, Screen, SectionTitle } from '../../src/components';
import { useSession } from '../../src/session';
import { getApiBase } from '../../src/api';
import { colors, fonts, spacing } from '../../src/theme';

export default function ProfileScreen() {
  const { user, vehicleId, signOut } = useSession();

  return (
    <Screen style={{ paddingHorizontal: 0 }}>
      <ScrollView contentContainerStyle={styles.pad}>
        <BrandMark />
        <SectionTitle>Profile</SectionTitle>
        <Text style={styles.sub}>Account, vehicle source honesty, Phase 1 limits.</Text>

        <View style={styles.card}>
          <Text style={styles.label}>Signed in</Text>
          <Text style={styles.value}>{user?.phone_e164}</Text>
          <Text style={styles.meta}>Role {user?.role} · id {user?.id?.slice(0, 8)}…</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Active vehicle</Text>
          <Text style={styles.value}>{vehicleId?.slice(0, 8)}…</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            <Chip label="MANUAL source" tone="manual" />
            <Chip label="OEM: none" tone="est" />
          </View>
        </View>

        <Banner text={`API: ${getApiBase()}`} />
        <Banner
          tone="warn"
          text="Out of scope in Phase 1: AI assistant, community, live OEM SOC, reliability score as operator telemetry, remote charge control."
        />

        <Button title="Sign out" variant="ghost" onPress={() => signOut()} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing[4], paddingBottom: 48, gap: 8 },
  sub: { fontFamily: fonts.sans, color: colors.textSecondary, marginBottom: 12 },
  card: {
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  label: { fontFamily: fonts.sans, color: colors.textTertiary, fontSize: 12 },
  value: { fontFamily: fonts.sansSemi, color: colors.textPrimary, fontSize: 16, marginTop: 4 },
  meta: { fontFamily: fonts.sans, color: colors.textTertiary, fontSize: 12, marginTop: 4 },
});
