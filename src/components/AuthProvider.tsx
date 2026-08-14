"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { ensureProfile } from "@/lib/cloud";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { setCurrentUserId } from "@/lib/userScope";

export type AuthStatus =
  | "loading" // deciding / restoring the session
  | "local" // Supabase not configured — app runs offline
  | "signed-in"
  | "signed-out";

interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  session: Session | null;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  status: "loading",
  user: null,
  session: null,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  /* Whether the session has been resolved (lazy init so local mode never
     flashes "loading"). */
  const [resolved, setResolved] = useState<boolean>(
    () => !isSupabaseConfigured || !supabase
  );

  /* After an OAuth redirect the tokens live in the URL hash. If we leave them
     there, the next reload re-reads them and gotrue-js treats them as stale
     (>120s old) and drops the session. Strip the hash once we have it. */
  const cleanUrlHash = useCallback(() => {
    if (window.location.hash) {
      history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search
      );
    }
  }, []);

  const status: AuthStatus = !isSupabaseConfigured || !supabase
    ? "local"
    : !resolved
      ? "loading"
      : session
        ? "signed-in"
        : "signed-out";

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    let mounted = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setCurrentUserId(data.session?.user?.id ?? null);
      setResolved(true);
      if (data.session) cleanUrlHash();
      if (data.session?.user) void ensureProfile(data.session.user);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(
      (_event, currentSession) => {
        setSession(currentSession);
        setUser(currentSession?.user ?? null);
        setCurrentUserId(currentSession?.user?.id ?? null);
        setResolved(true);
        if (currentSession) cleanUrlHash();
        if (currentSession?.user) void ensureProfile(currentSession.user);
      }
    );

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [cleanUrlHash]);

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut();
    setUser(null);
    setSession(null);
    setCurrentUserId(null);
    setResolved(true);
  }, []);

  const value = useMemo(
    () => ({ status, user, session, signOut }),
    [status, user, session, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
