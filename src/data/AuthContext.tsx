import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AuthError, Session, User } from "@supabase/supabase-js";
import { getSupabaseClient } from "./persistence";
import { isDemoMode } from "./env";

interface AuthContextValue {
  configured: boolean;
  loading: boolean;
  session: Session | null;
  user: User | null;
  error: string;
  signUp: (email: string, password: string, displayName: string) => Promise<{ confirmationRequired: boolean }>;
  signIn: (email: string, password: string) => Promise<void>;
  reauthenticate: (password: string) => Promise<void>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function errorMessage(error: AuthError): string {
  return error.message || "Authentication could not be completed. Please try again.";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(!isDemoMode);
  const [configured, setConfigured] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void getSupabaseClient().then(async (supabase) => {
      if (!active) return;
      if (!supabase) {
        setSession(null);
        setLoading(false);
        return;
      }
      setConfigured(true);
      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
        if (active) {
          setSession(nextSession);
          setLoading(false);
        }
      });
      unsubscribe = () => subscription.unsubscribe();
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (!active) return;
      if (sessionError) {
        setError(errorMessage(sessionError));
        setLoading(false);
        return;
      }
      setSession(data.session);
      setLoading(false);
    }).catch((clientError: unknown) => {
      if (!active) return;
      console.error("Could not initialize Supabase authentication.", clientError);
      setError(clientError instanceof Error ? clientError.message : "Could not initialize account access.");
      setLoading(false);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const signUp = useCallback(async (email: string, password: string, displayName: string) => {
    const supabase = await getSupabaseClient();
    if (!supabase) throw new Error("Cloud authentication is not configured. Demo mode remains local to this browser.");
    setError("");
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName } },
    });
    if (signUpError) {
      const message = errorMessage(signUpError);
      setError(message);
      throw new Error(message);
    }
    if (data.session) setSession(data.session);
    return { confirmationRequired: !data.session };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const supabase = await getSupabaseClient();
    if (!supabase) throw new Error("Cloud authentication is not configured. Demo mode remains local to this browser.");
    setError("");
    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      const message = errorMessage(signInError);
      setError(message);
      throw new Error(message);
    }
    setSession(data.session);
  }, []);

  const reauthenticate = useCallback(async (password: string) => {
    const supabase = await getSupabaseClient();
    if (!supabase) throw new Error("Cloud authentication is not configured.");
    const email = session?.user.email;
    if (!email) throw new Error("A password-based account is required for this confirmation flow.");
    setError("");
    const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) {
      const message = errorMessage(authError);
      setError(message);
      throw new Error(message);
    }
    setSession(data.session);
  }, [session?.user.email]);

  const signOut = useCallback(async () => {
    const supabase = await getSupabaseClient();
    if (!supabase) return;
    setError("");
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      const message = errorMessage(signOutError);
      setError(message);
      throw new Error(message);
    }
    setSession(null);
  }, []);
  const clearError = useCallback(() => setError(""), []);

  const value = useMemo<AuthContextValue>(() => ({
    configured: !isDemoMode && configured,
    loading,
    session,
    user: session?.user ?? null,
    error,
    signUp,
    signIn,
    reauthenticate,
    signOut,
    clearError,
  }), [configured, loading, session, error, signUp, signIn, reauthenticate, signOut, clearError]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider.");
  return context;
}

export function useOptionalAuth(): AuthContextValue | null {
  return useContext(AuthContext);
}
