import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Platform,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { colors, fonts } from './theme';

const FRAME_W = 390;
const FRAME_H = 844;
const BEZEL = 12;
const RADIUS = 36;

/**
 * On web desktop, center a phone-sized device frame so Try Live feels like a
 * native app — not a stretched marketing page. On native / narrow viewports,
 * pass children through unchanged (or lightly constrained).
 *
 * Avoid CSS `scale` transforms: they break coordinate-based automation and
 * confuse hit-testing for some desktop demo tools.
 */
export function PhoneShell({ children }: { children: React.ReactNode }) {
  const { width, height } = useWindowDimensions();
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    // useNativeDriver:false on web — opacity+native driver can leave the
    // subtree non-interactive (blocks OTP / tab taps in desktop demos).
    Animated.timing(fade, {
      toValue: 1,
      duration: 420,
      useNativeDriver: false,
    }).start();
  }, [fade]);

  if (Platform.OS !== 'web') {
    return <>{children}</>;
  }

  const needsFrame = width >= FRAME_W + 64 && height >= 700;

  if (!needsFrame) {
    return (
      <View style={styles.fillNative}>
        <View style={styles.appFill}>{children}</View>
      </View>
    );
  }

  // Fit without transform scale: shrink frame height if viewport is short
  const maxH = Math.min(FRAME_H, Math.floor(height - 56));
  const frameH = Math.max(640, maxH);

  return (
    <View style={styles.stage} testID="phone-stage">
      <View pointerEvents="none" style={styles.stageGlow} />
      <Animated.View style={[styles.stageInner, { opacity: fade }]}>
        <Text style={styles.stageLabel}>EVSaathi · phone preview</Text>
        <View style={[styles.device, { height: frameH }]} testID="phone-device">
          <View pointerEvents="none" style={styles.notchRow}>
            <View style={styles.notch} />
          </View>
          <View style={styles.screen}>{children}</View>
          <View pointerEvents="none" style={styles.homeIndicatorTrack}>
            <View style={styles.homeIndicator} />
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  fillNative: {
    flex: 1,
    backgroundColor: colors.bgBase,
    height: '100%' as unknown as number,
    minHeight: '100%' as unknown as number,
  },
  appFill: {
    flex: 1,
    maxWidth: FRAME_W,
    width: '100%',
    alignSelf: 'center',
    backgroundColor: colors.bgBase,
    overflow: 'hidden',
  },
  stage: {
    flex: 1,
    minHeight: '100%' as unknown as number,
    height: '100%' as unknown as number,
    width: '100%',
    backgroundColor: '#04060C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stageGlow: {
    position: 'absolute',
    width: 520,
    height: 520,
    borderRadius: 260,
    backgroundColor: 'rgba(46, 230, 166, 0.05)',
    top: '12%' as unknown as number,
  },
  stageInner: {
    alignItems: 'center',
    gap: 14,
  },
  stageLabel: {
    fontFamily: fonts.sansMed,
    color: colors.textTertiary,
    fontSize: 12,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  device: {
    width: FRAME_W,
    backgroundColor: '#0A0E18',
    borderRadius: RADIUS,
    borderWidth: 2,
    borderColor: '#1E2A3D',
    padding: BEZEL,
    overflow: 'hidden',
  },
  notchRow: {
    position: 'absolute',
    top: 10,
    left: 0,
    right: 0,
    zIndex: 2,
    alignItems: 'center',
  },
  notch: {
    width: 118,
    height: 28,
    borderRadius: 18,
    backgroundColor: '#05080F',
    borderWidth: 1,
    borderColor: '#121A28',
  },
  screen: {
    flex: 1,
    backgroundColor: colors.bgBase,
    borderRadius: RADIUS - BEZEL,
    overflow: 'hidden',
  },
  homeIndicatorTrack: {
    position: 'absolute',
    bottom: 6,
    left: 0,
    right: 0,
    zIndex: 2,
    alignItems: 'center',
  },
  homeIndicator: {
    width: 108,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(242,245,250,0.22)',
  },
});
