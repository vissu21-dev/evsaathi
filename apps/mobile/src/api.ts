import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

function defaultApiBase(): string {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL;
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const host = window.location.hostname || '127.0.0.1';
    return `http://${host}:4000/v1`;
  }
  if (Platform.OS === 'android') return 'http://10.0.2.2:4000/v1';
  return 'http://127.0.0.1:4000/v1';
}

export function getApiBase(): string {
  return defaultApiBase();
}

const TOKEN_KEY = 'evsaathi_access_token';
const USER_KEY = 'evsaathi_user';
const VEHICLE_KEY = 'evsaathi_vehicle_id';

export async function getToken() {
  return AsyncStorage.getItem(TOKEN_KEY);
}

export async function setSession(token: string, user: unknown) {
  await AsyncStorage.setItem(TOKEN_KEY, token);
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
}

export async function clearSession() {
  await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY, VEHICLE_KEY]);
}

export async function getStoredUser<T>(): Promise<T | null> {
  const raw = await AsyncStorage.getItem(USER_KEY);
  return raw ? (JSON.parse(raw) as T) : null;
}

export async function getPrimaryVehicleId() {
  return AsyncStorage.getItem(VEHICLE_KEY);
}

export async function setPrimaryVehicleId(id: string) {
  await AsyncStorage.setItem(VEHICLE_KEY, id);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  opts: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string>),
  };
  if (opts.auth !== false) {
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${getApiBase()}${path}`, { ...opts, headers });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      res.status,
      json?.error?.code || 'ERROR',
      json?.error?.message || res.statusText,
    );
  }
  return json as T;
}
