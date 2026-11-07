import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts, spacing } from './theme';

export function Screen({
  children,
  style,
  atmosphere = false,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  /** Soft night-road gradient behind content (Home / Login). */
  atmosphere?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.screen,
        { paddingTop: Math.max(insets.top, spacing[4]) },
        atmosphere && styles.atmosphere,
        style,
      ]}
    >
      {atmosphere ? <View pointerEvents="none" style={styles.atmosphereOrb} /> : null}
      {children}
    </View>
  );
}

export function BrandMark({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' | 'hero' }) {
  const fs = size === 'hero' ? 40 : size === 'lg' ? 34 : size === 'sm' ? 18 : 24;
  const pulse = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    if (size !== 'hero' && size !== 'lg') return;
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1400, useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 0.45, duration: 1400, useNativeDriver: false }),
      ]),
    ).start();
  }, [pulse, size]);

  return (
    <View style={styles.brandRow}>
      <Animated.View
        style={[
          styles.brandNode,
          size === 'hero' || size === 'lg' ? { opacity: pulse } : { opacity: 0.85 },
        ]}
      />
      <Text style={[styles.brand, { fontSize: fs }]}>
        EV<Text style={{ color: colors.teal400 }}>Saathi</Text>
      </Text>
    </View>
  );
}

export function Chip({
  label,
  tone = 'manual',
}: {
  label: string;
  tone?: 'manual' | 'est' | 'demo' | 'live' | 'synced';
}) {
  const map = {
    manual: { bg: colors.chipManualBg, fg: colors.chipManualFg },
    est: { bg: colors.chipEstBg, fg: colors.chipEstFg },
    demo: { bg: colors.chipDemoBg, fg: colors.chipDemoFg },
    live: { bg: colors.chipLiveBg, fg: colors.chipLiveFg },
    synced: { bg: colors.chipDemoBg, fg: colors.chipDemoFg },
  }[tone];
  return (
    <View style={[styles.chip, { backgroundColor: map.bg }]}>
      <Text style={[styles.chipText, { color: map.fg }]}>{label}</Text>
    </View>
  );
}

export function labelTone(dataLabel?: string | null): 'manual' | 'est' | 'demo' | 'live' | 'synced' {
  if (!dataLabel) return 'est';
  if (dataLabel === 'live') return 'live';
  if (dataLabel === 'recently_synchronized') return 'synced';
  if (dataLabel === 'estimated') return 'est';
  if (dataLabel === 'imported') return 'synced';
  return 'manual';
}

export function chipText(dataLabel?: string | null) {
  const map: Record<string, string> = {
    live: 'LIVE',
    recently_synchronized: 'SYNCED',
    manually_entered: 'MANUAL',
    imported: 'IMPORT',
    estimated: 'EST.',
  };
  return map[dataLabel || ''] || 'EST.';
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost' | 'amber';
  disabled?: boolean;
  loading?: boolean;
}) {
  const bg =
    variant === 'primary'
      ? colors.teal400
      : variant === 'amber'
        ? colors.amber400
        : 'transparent';
  const fg = variant === 'ghost' ? colors.teal400 : colors.textInverse;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.btn,
        {
          backgroundColor: bg,
          borderColor: variant === 'ghost' ? colors.borderStrong : bg,
          opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.btnText, { color: fg }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Field({
  label,
  ...props
}: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: 6, marginBottom: spacing[3] }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.textTertiary}
        style={styles.input}
        {...props}
      />
    </View>
  );
}

export function Banner({ text, tone = 'info' }: { text: string; tone?: 'info' | 'warn' }) {
  return (
    <View
      style={[
        styles.banner,
        {
          borderColor: tone === 'warn' ? colors.amber400 : colors.info,
          backgroundColor:
            tone === 'warn' ? 'rgba(245,185,66,0.08)' : 'rgba(91,140,255,0.08)',
        },
      ]}
    >
      <Text style={styles.bannerText}>{text}</Text>
    </View>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

export function LoadingBlock() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.teal400} />
      <Text style={styles.muted}>Loading…</Text>
    </View>
  );
}

export function SocArc({ percent }: { percent: number }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: percent,
      duration: 700,
      useNativeDriver: false,
    }).start();
  }, [percent, anim]);

  const color =
    percent < 20 ? colors.danger : percent < 40 ? colors.amber400 : colors.teal400;

  return (
    <View style={styles.socWrap}>
      <View style={styles.socTrack}>
        <Animated.View
          style={[
            styles.socFill,
            {
              width: anim.interpolate({
                inputRange: [0, 100],
                outputRange: ['0%', '100%'],
              }),
              backgroundColor: color,
            },
          ]}
        />
      </View>
      <Text style={[styles.socNum, { color }]}>
        {Math.round(percent)}
        <Text style={styles.socUnit}>%</Text>
      </Text>
    </View>
  );
}

export function SectionTitle({ children }: { children: string }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function Muted({ children }: { children: React.ReactNode }) {
  return <Text style={styles.muted}>{children}</Text>;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bgBase,
    paddingHorizontal: spacing[4],
    overflow: 'hidden',
  },
  atmosphere: {
    // @ts-expect-error web CSS gradient
    backgroundImage:
      Platform.OS === 'web'
        ? 'radial-gradient(120% 70% at 50% -8%, #122033 0%, #070B14 58%), linear-gradient(180deg, #0B1220 0%, #070B14 100%)'
        : undefined,
  },
  atmosphereOrb: {
    position: 'absolute',
    top: -40,
    alignSelf: 'center',
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(46, 230, 166, 0.06)',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brandNode: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.amber400,
  },
  brand: {
    fontFamily: fonts.displayBold,
    color: colors.textPrimary,
    letterSpacing: -0.5,
  },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  chipText: {
    fontFamily: fonts.sansSemi,
    fontSize: 11,
    letterSpacing: 0.6,
  },
  btn: {
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
  },
  btnText: {
    fontFamily: fonts.sansSemi,
    fontSize: 16,
  },
  fieldLabel: {
    fontFamily: fonts.sansMed,
    color: colors.textSecondary,
    fontSize: 13,
  },
  input: {
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.textPrimary,
    fontFamily: fonts.sans,
    fontSize: 16,
  },
  banner: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  bannerText: {
    color: colors.textSecondary,
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 18,
  },
  empty: {
    padding: 24,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: {
    fontFamily: fonts.sansSemi,
    color: colors.textPrimary,
    fontSize: 16,
  },
  emptyBody: {
    fontFamily: fonts.sans,
    color: colors.textSecondary,
    textAlign: 'center',
    fontSize: 14,
  },
  loading: {
    padding: 32,
    alignItems: 'center',
    gap: 10,
  },
  muted: {
    fontFamily: fonts.sans,
    color: colors.textTertiary,
    fontSize: 13,
  },
  socWrap: {
    gap: 10,
  },
  socTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: colors.socTrack,
    overflow: 'hidden',
  },
  socFill: {
    height: '100%',
    borderRadius: 999,
  },
  socNum: {
    fontFamily: fonts.monoSemi,
    fontSize: 56,
    lineHeight: 60,
  },
  socUnit: {
    fontSize: 24,
    color: colors.textSecondary,
  },
  sectionTitle: {
    fontFamily: fonts.sansSemi,
    color: colors.textPrimary,
    fontSize: 18,
    marginBottom: 8,
  },
});
