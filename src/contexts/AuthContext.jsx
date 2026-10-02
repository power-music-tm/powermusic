import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const AuthContext = createContext(null);

async function fetchProfile(userId) {
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data, error } = await supabase
      .from('powermusic_users')
      .select('id, email, full_name, role')
      .eq('id', userId)
      .single();

    if (!error && data) {
      return data;
    }

    lastError = error;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw lastError ?? new Error('Profile not found');
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (userId) => {
    try {
      const nextProfile = await fetchProfile(userId);
      setProfile(nextProfile);
      return nextProfile;
    } catch {
      setProfile(null);
      return null;
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    async function initAuth() {
      const { data: { session: initialSession } } = await supabase.auth.getSession();

      if (!mounted) return;

      setSession(initialSession);

      if (initialSession?.user) {
        await loadProfile(initialSession.user.id);
      } else {
        setProfile(null);
      }

      if (mounted) {
        setLoading(false);
      }
    }

    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      setSession(nextSession);

      if (nextSession?.user) {
        await loadProfile(nextSession.user.id);
      } else {
        setProfile(null);
      }

      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signIn = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;

    const nextProfile = await fetchProfile(data.user.id);
    setProfile(nextProfile);
    return { user: data.user, profile: nextProfile };
  }, []);

  const signUp = useCallback(async (email, password, fullName) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
      },
    });

    if (error) throw error;

    if (data.user) {
      const nextProfile = await fetchProfile(data.user.id);
      setProfile(nextProfile);
      return { user: data.user, profile: nextProfile, session: data.session };
    }

    return { user: null, profile: null, session: data.session };
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setProfile(null);
  }, []);

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      role: profile?.role ?? null,
      loading,
      signIn,
      signUp,
      signOut,
      isAdmin: profile?.role === 'admin',
      isManager: profile?.role === 'manager',
    }),
    [session, profile, loading, signIn, signUp, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
