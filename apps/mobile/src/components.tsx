import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { colors, fonts, spacing } from './theme';

export function Screen({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return <View style={[styles.screen, style]}>{children}</View>;
}

export function BrandMark({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const fs = size === 'lg' ? 34 : size === 'sm' ? 18 : 24;
  return (
    <Text style={[styles.brand, { fontSize: fs }]}>
      EV<Text style={{ color: colors.teal400 }}>Saathi</Text>
    </Text>
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
    paddingTop: spacing[4],
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
