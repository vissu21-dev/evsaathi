import { Redirect } from 'expo-router';
import { useSession } from '../src/session';

export default function Index() {
  const { user, vehicleId, ready } = useSession();
  if (!ready) return null;
  if (!user) return <Redirect href="/auth/login" />;
  if (!vehicleId) return <Redirect href="/onboarding/vehicle" />;
  return <Redirect href="/(tabs)/home" />;
}
