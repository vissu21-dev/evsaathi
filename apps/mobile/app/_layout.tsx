import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk';
import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
} from '@expo-google-fonts/manrope';
import {
  JetBrainsMono_500Medium,
  JetBrainsMono_600SemiBold,
} from '@expo-google-fonts/jetbrains-mono';
import { SessionProvider, useSession } from '../src/session';
import { PhoneShell } from '../src/PhoneShell';
import { colors } from '../src/theme';

function AuthGate({ children }: { children: React.ReactNode }) {
  const { ready, user, vehicleId } = useSession();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    const inAuth = segments[0] === 'auth';
    const inOnboard = segments[0] === 'onboarding';
    if (!user && !inAuth) {
      router.replace('/auth/login');
      return;
    }
    // After OTP: send new users to vehicle setup even while still on /auth
    if (user && !vehicleId && !inOnboard) {
      router.replace('/onboarding/vehicle');
      return;
    }
    if (user && vehicleId && (inAuth || inOnboard)) {
      router.replace('/(tabs)/home');
    }
  }, [ready, user, vehicleId, segments, router]);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bgBase, justifyContent: 'center' }}>
        <ActivityIndicator color={colors.teal400} />
      </View>
    );
  }
  return <>{children}</>;
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    JetBrainsMono_500Medium,
    JetBrainsMono_600SemiBold,
  });

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bgBase, justifyContent: 'center' }}>
        <ActivityIndicator color={colors.teal400} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="light" />
        <PhoneShell>
          <AuthGate>
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.bgBase },
              }}
            >
              <Stack.Screen name="index" />
              <Stack.Screen name="auth/login" />
              <Stack.Screen name="onboarding/vehicle" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen
                name="stations/[id]"
                options={{
                  headerShown: true,
                  title: 'Station',
                  headerStyle: { backgroundColor: colors.bgElevated },
                  headerTintColor: colors.textPrimary,
                }}
              />
              <Stack.Screen
                name="range"
                options={{
                  headerShown: true,
                  title: 'Range calculator',
                  headerStyle: { backgroundColor: colors.bgElevated },
                  headerTintColor: colors.textPrimary,
                }}
              />
              <Stack.Screen
                name="log-session"
                options={{
                  headerShown: true,
                  title: 'Log charge',
                  headerStyle: { backgroundColor: colors.bgElevated },
                  headerTintColor: colors.textPrimary,
                }}
              />
              <Stack.Screen
                name="log-soc"
                options={{
                  headerShown: true,
                  title: 'Update SOC',
                  headerStyle: { backgroundColor: colors.bgElevated },
                  headerTintColor: colors.textPrimary,
                }}
              />
              <Stack.Screen
                name="notifications"
                options={{
                  headerShown: true,
                  title: 'Notifications',
                  headerStyle: { backgroundColor: colors.bgElevated },
                  headerTintColor: colors.textPrimary,
                }}
              />
              <Stack.Screen
                name="integrations"
                options={{
                  headerShown: true,
                  title: 'Integrations',
                  headerStyle: { backgroundColor: colors.bgElevated },
                  headerTintColor: colors.textPrimary,
                }}
              />
              <Stack.Screen
                name="assistant"
                options={{
                  headerShown: true,
                  title: 'AI assistant',
                  headerStyle: { backgroundColor: colors.bgElevated },
                  headerTintColor: colors.textPrimary,
                }}
              />
            </Stack>
          </AuthGate>
        </PhoneShell>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
