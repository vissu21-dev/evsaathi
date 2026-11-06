import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  api,
  clearSession,
  getPrimaryVehicleId,
  getStoredUser,
  getToken,
  setPrimaryVehicleId,
  setSession,
} from './api';

type User = {
  id: string;
  phone_e164: string;
  role: string;
  display_name?: string;
  is_new?: boolean;
};

type SessionCtx = {
  ready: boolean;
  user: User | null;
  vehicleId: string | null;
  signIn: (token: string, user: User) => Promise<void>;
  signOut: () => Promise<void>;
  setVehicleId: (id: string) => Promise<void>;
  refreshVehicle: () => Promise<void>;
};

const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [vehicleId, setVehicleIdState] = useState<string | null>(null);

  const refreshVehicle = useCallback(async () => {
    const token = await getToken();
    if (!token) {
      setVehicleIdState(null);
      return;
    }
    const stored = await getPrimaryVehicleId();
    if (stored) {
      setVehicleIdState(stored);
      return;
    }
    try {
      const res = await api<{ data: { id: string; is_primary: boolean }[] }>('/vehicles');
      const primary = res.data.find((v) => v.is_primary) || res.data[0];
      if (primary) {
        await setPrimaryVehicleId(primary.id);
        setVehicleIdState(primary.id);
      } else {
        setVehicleIdState(null);
      }
    } catch {
      setVehicleIdState(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const token = await getToken();
      const u = await getStoredUser<User>();
      if (token && u) {
        setUser(u);
        await refreshVehicle();
      }
      setReady(true);
    })();
  }, [refreshVehicle]);

  const value = useMemo<SessionCtx>(
    () => ({
      ready,
      user,
      vehicleId,
      signIn: async (token, u) => {
        await setSession(token, u);
        setUser(u);
        await refreshVehicle();
      },
      signOut: async () => {
        await clearSession();
        setUser(null);
        setVehicleIdState(null);
      },
      setVehicleId: async (id) => {
        await setPrimaryVehicleId(id);
        setVehicleIdState(id);
      },
      refreshVehicle,
    }),
    [ready, user, vehicleId, refreshVehicle],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('SessionProvider missing');
  return ctx;
}
