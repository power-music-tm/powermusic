import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { getSupabase, isSupabaseConfigured } from '../supabaseClient';
import { isAdminEmail } from '../utils/adminAccess';
import {
  validateManagerEmail,
  validateManagerSignupFields,
  ensureManagerAllowedDomains,
  MANAGER_ACCOUNT_EXISTS_MESSAGE,
  MANAGER_ACCOUNT_NOT_FOUND_MESSAGE,
} from '../utils/managerAuth';
import { getAuthCallbackUrl } from '../utils/authRedirect';
import { clearAuthCache, readAuthCache, writeAuthCache } from '../utils/authCache';
import { readInitialAuthState, clearStoredSession, readStoredSession, isSessionExpired } from '../utils/authBootstrap';
import { setAccessTokenProvider, getApiUrl } from '../utils/api';
import { requestManagerPasswordReset, resendManagerSignupConfirmation } from '../utils/managerAuthEmail';

const AuthContext = createContext(null);

const AUTH_TIMEOUT_MS = 15000;

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

async function fetchUserProfileViaBackend(accessToken, email) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(getApiUrl('/api/auth/me'), {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const body = await res.json();
        detail = body.detail ?? detail;
      } catch {
        /* keep statusText */
      }
      if (res.status === 403) {
        if (isAdminEmail(email)) {
          throw new Error(
            'Admin profile is missing. Run backend/seed_admin.py against this database, then try again.',
          );
        }
        throw new Error(
          typeof detail === 'string' ? detail : 'User profile not found.',
        );
      }
      throw new Error(
        typeof detail === 'string' ? detail : 'Failed to retrieve user role from database.',
      );
    }
    return res.json();
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('Could not load your account profile. Try again in a moment.');
    }
    throw err;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function fetchUserProfile(userId, { accessToken, email } = {}) {
  if (accessToken) {
    return fetchUserProfileViaBackend(accessToken, email);
  }

  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase is not configured.');

  let lastError = null;
  let triedEnsure = false;
  const maxAttempts = 5;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const { data, error } = await supabase
      .from('powermusic_users')
      .select('id, email, full_name, first_name, last_name, club, role')
      .eq('id', userId)
      .single();

    if (!error && data) return data;

    lastError = error;

    if (error?.code === 'PGRST116' && !triedEnsure) {
      triedEnsure = true;
      const { data: authData } = await supabase.auth.getUser();
      if (isAdminEmail(authData.user?.email)) {
        throw new Error(
          'Admin profile is missing. Run backend/seed_admin.py against this database, then try again.',
        );
      }
      const { data: ensured, error: ensureError } = await supabase.rpc('ensure_manager_profile');
      if (!ensureError && ensured) return ensured;
      if (ensureError) lastError = ensureError;
    }

    if (attempt < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  throw lastError ?? new Error('Failed to retrieve user role from database.');
}

function applyProfile(setRole, setProfile, profileData) {
  setRole(profileData.role);
  setProfile(profileData);
  writeAuthCache(profileData.id, profileData);
}

const getLoginFriendlyError = (error) => {
  if (!error) return 'Authentication failed.';
  const msg = error.message || '';
  if (msg.includes('Email not confirmed') || msg.includes('Email not verified')) {
    return 'Your email address has not been verified yet. Please check your inbox and click the verification link before signing in.';
  }
  if (msg.includes('Invalid login credentials') || msg.includes('invalid_credentials')) {
    return 'Incorrect email or password. Please verify your credentials and try again.';
  }
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
    return 'Network error: Please check your internet connection and try again.';
  }
  if (msg.includes('too many requests') || msg.includes('Too many login attempts')) {
    return 'Too many login attempts. Your account has been temporarily locked. Please try again in a few minutes.';
  }
  return error.message || 'Authentication failed. Please try again.';
};

const getSignupFriendlyError = (error) => {
  if (!error) return 'Registration failed.';
  const msg = error.message || '';
  if (msg.includes('already registered') || msg.includes('User already exists')) {
    return MANAGER_ACCOUNT_EXISTS_MESSAGE;
  }
  if (msg.includes('Password should be at least 6 characters')) {
    return 'Password is too weak. It must be at least 6 characters long.';
  }
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
    return 'Network error: Unable to connect to the authentication server. Please check your internet connection and try again.';
  }
  return error.message || 'Registration failed. Please check your details and try again.';
};

const getOtpFriendlyError = (error) => {
  if (!error) return 'Could not send sign-in link.';
  const msg = error.message || '';
  if (msg.includes('too many requests') || msg.includes('rate limit') || msg.includes('429')) {
    return 'Too many sign-up attempts. Wait at least 60 seconds, then try again. If this keeps happening, check Supabase → Authentication → Rate Limits or wait up to an hour after heavy testing.';
  }
  if (msg.includes('Signups not allowed')) {
    return 'New registrations are temporarily unavailable. Please contact support.';
  }
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
    return 'Network error: Please check your internet connection and try again.';
  }
  return error.message || 'Could not send sign-in link.';
};

export function AuthProvider({ children }) {
  const initialAuth = readInitialAuthState();
  const [user, setUser] = useState(initialAuth.user);
  const [session, setSession] = useState(initialAuth.session);
  const [role, setRole] = useState(initialAuth.role);
  const [profile, setProfile] = useState(initialAuth.profile);
  const [appConfig] = useState({ enforceDomainCheck: true });
  const [initializing, setInitializing] = useState(false);
  const [authReady, setAuthReady] = useState(() => !isSupabaseConfigured());
  const initialSessionHandled = useRef(false);
  const authEpoch = useRef(0);
  const authTransitionRef = useRef(false);

  const bumpAuthEpoch = () => {
    authEpoch.current += 1;
    return authEpoch.current;
  };

  const isStaleAuthEpoch = (epoch) => epoch !== authEpoch.current;

  useEffect(() => {
    setAccessTokenProvider(async () => {
      // Only hand out tokens that are still valid — an expired token turns
      // every API call into a 401. readStoredSession() already drops expired
      // sessions; for the in-memory one we check explicitly.
      if (session?.access_token && !isSessionExpired(session)) return session.access_token;

      const stored = readStoredSession();
      if (stored?.access_token) return stored.access_token;

      const supabase = getSupabase();
      if (!supabase) return null;

      // getSession() silently refreshes an expired session when possible.
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    });
  }, [session]);

  useEffect(() => {
    let active = true;
    const supabase = getSupabase();

    if (!isSupabaseConfigured() || !supabase) {
      setAuthReady(true);
      return undefined;
    }

    async function clearAuthState() {
      clearAuthCache();
      await supabase.auth.signOut();
      if (!active) return;
      setSession(null);
      setUser(null);
      setRole(null);
      setProfile(null);
    }

    // The API layer fires this when a request comes back 401. Try a silent
    // refresh first — a recoverable token blip should not dump managers to signup.
    let sessionExpiredHandled = false;
    const onSessionExpired = () => {
      if (sessionExpiredHandled) return;
      sessionExpiredHandled = true;
      window.setTimeout(() => { sessionExpiredHandled = false; }, 3000);

      (async () => {
        try {
          const { data, error } = await supabase.auth.refreshSession();
          if (!error && data?.session?.access_token) {
            if (!active) return;
            setSession(data.session);
            setUser(data.session.user ?? null);
            await refreshProfile(data.session, { allowCachedFallback: true });
            return;
          }
        } catch (err) {
          console.error('Session refresh after 401 failed:', err);
        }
        clearStoredSession();
        await clearAuthState();
      })();
    };
    window.addEventListener('auth:session-expired', onSessionExpired);

    async function refreshProfile(currentSession, { allowCachedFallback = false } = {}) {
      const currentUser = currentSession?.user ?? null;
      if (!currentUser) return;

      try {
        const profileData = await fetchUserProfile(currentUser.id, {
          accessToken: currentSession?.access_token,
          email: currentUser.email,
        });
        if (!active) return;
        applyProfile(setRole, setProfile, profileData);
      } catch (err) {
        console.error('Error fetching profile:', err);
        // Keep the signed-in session if we already know the role. A transient
        // /api/auth/me failure must not bounce managers back to signup.
        const cached = readAuthCache(currentUser.id);
        if (allowCachedFallback || cached) {
          if (cached && active) {
            setRole(cached.role);
            setProfile(cached.profile);
          }
          return;
        }
        await clearAuthState();
      }
    }

    async function hydrateSession(currentSession, epoch) {
      if (isStaleAuthEpoch(epoch)) return;

      setSession(currentSession);
      const currentUser = currentSession?.user ?? null;
      setUser(currentUser);

      if (!currentUser) {
        clearAuthCache();
        setRole(null);
        setProfile(null);
        return;
      }

      const cached = readAuthCache(currentUser.id);
      if (cached) {
        setRole(cached.role);
        setProfile(cached.profile);
        await refreshProfile(currentSession, { allowCachedFallback: true });
        return;
      }

      await refreshProfile(currentSession, { allowCachedFallback: false });
    }

    const bootEpoch = authEpoch.current;
    const finishBoot = () => {
      if (active) setAuthReady(true);
    };

    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (!active || isStaleAuthEpoch(bootEpoch)) return;
        initialSessionHandled.current = true;
        try {
          await hydrateSession(data.session, bootEpoch);
        } catch (err) {
          console.error('Auth bootstrap failed:', err);
        } finally {
          finishBoot();
        }
      })
      .catch((err) => {
        console.error('Auth getSession failed:', err);
        finishBoot();
      });

    const bootTimeout = window.setTimeout(finishBoot, 8000);

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, currentSession) => {
      if (!active) return;
      const eventEpoch = authEpoch.current;

      if (event === 'INITIAL_SESSION') {
        if (initialSessionHandled.current) return;
        initialSessionHandled.current = true;
        await hydrateSession(currentSession, eventEpoch);
        setAuthReady(true);
        return;
      }

      if (event === 'SIGNED_OUT') {
        if (authTransitionRef.current) return;
        bumpAuthEpoch();
        clearAuthCache();
        clearStoredSession();
        setSession(null);
        setUser(null);
        setRole(null);
        setProfile(null);
        return;
      }

      if (event === 'TOKEN_REFRESHED') {
        if (authTransitionRef.current) return;
        if (isStaleAuthEpoch(eventEpoch)) return;
        setSession(currentSession);
        setUser(currentSession?.user ?? null);
        await refreshProfile(currentSession, { allowCachedFallback: true });
        return;
      }

      // login() owns session + profile updates — avoid parallel refresh/sign-out races
      if (authTransitionRef.current) return;

      if (isStaleAuthEpoch(eventEpoch)) return;

      setSession(currentSession);
      setUser(currentSession?.user ?? null);

      if (!currentSession?.user) {
        clearAuthCache();
        setRole(null);
        setProfile(null);
        return;
      }

      const cached = readAuthCache(currentSession.user.id);
      if (cached) {
        setRole(cached.role);
        setProfile(cached.profile);
      }

      await refreshProfile(currentSession, { allowCachedFallback: Boolean(cached) });
    });

    return () => {
      active = false;
      window.clearTimeout(bootTimeout);
      subscription.unsubscribe();
      window.removeEventListener('auth:session-expired', onSessionExpired);
    };
  }, []);

  const login = async (email, password, expectedRole) => {
    const supabase = getSupabase();
    if (!supabase) {
      throw new Error(
        'Authentication is not configured. Create frontend/.env.local with VITE_SUPABASE_ANON_KEY, then hard-refresh the page.'
      );
    }

    authTransitionRef.current = true;
    try {
      const { data, error } = await withTimeout(
        supabase.auth.signInWithPassword({
          email,
          password,
        }),
        AUTH_TIMEOUT_MS,
        'Sign-in timed out. Check your internet connection and try again.',
      );
      if (error) {
        throw new Error(getLoginFriendlyError(error));
      }

      const profileData = await withTimeout(
        fetchUserProfile(data.user.id, {
          accessToken: data.session?.access_token,
          email: data.user.email,
        }),
        AUTH_TIMEOUT_MS,
        'Could not load your account profile. Try again in a moment.',
      );

      if (profileData.role !== expectedRole) {
        await supabase.auth.signOut();
        clearAuthCache();
        throw new Error(`Access Denied: You do not have permission to access the ${expectedRole} portal.`);
      }

      setUser(data.user);
      setSession(data.session);
      applyProfile(setRole, setProfile, profileData);
      setAuthReady(true);
      return data;
    } finally {
      authTransitionRef.current = false;
    }
  };

  const signup = async (email, password, metadata = {}) => {
    const supabase = getSupabase();
    if (!supabase) {
      throw new Error(
        'Authentication is not configured. Create frontend/.env.local with VITE_SUPABASE_ANON_KEY, then hard-refresh the page.'
      );
    }
    setInitializing(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: metadata,
        },
      });
      if (error) {
        throw new Error(getSignupFriendlyError(error));
      }
      return data;
    } finally {
      setInitializing(false);
    }
  };

  const logout = async () => {
    const supabase = getSupabase();
    bumpAuthEpoch();
    clearAuthCache();
    clearStoredSession();
    setUser(null);
    setSession(null);
    setRole(null);
    setProfile(null);

    if (!supabase) return;

    try {
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) throw error;
    } catch (err) {
      console.error('Sign out failed:', err);
    }
  };

  /** Admin portal — passwordless magic link (only for allowlisted emails). */
  const sendAdminMagicLink = async (email) => {
    const supabase = getSupabase();
    if (!supabase) {
      throw new Error(
        'Authentication is not configured. Create frontend/.env.local with VITE_SUPABASE_ANON_KEY, then hard-refresh the page.'
      );
    }

    const normalized = email.trim().toLowerCase();
    if (!normalized) {
      throw new Error('Please enter your email address.');
    }

    await supabase.auth.signOut();
    clearAuthCache();

    if (isAdminEmail(normalized)) {
      const redirectTo = getAuthCallbackUrl();
      const { error } = await supabase.auth.signInWithOtp({
        email: normalized,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: redirectTo,
        },
      });
      if (error) {
        throw new Error(error.message || 'Could not send sign-in link.');
      }
    }

    return { email: normalized };
  };

  /** Check whether a manager profile exists for this email (sign-in pre-check). */
  const checkManagerAccountExists = async (email, { enforceDomain = true } = {}) => {
    const supabase = getSupabase();
    if (!supabase) {
      throw new Error(
        'Authentication is not configured. Create frontend/.env.local with VITE_SUPABASE_ANON_KEY, then hard-refresh the page.'
      );
    }

    let allowedDomains;
    if (enforceDomain) {
      allowedDomains = await ensureManagerAllowedDomains();
    }
    const validated = validateManagerEmail(email, { enforceDomain, allowedDomains });
    if (!validated.ok) {
      throw new Error(validated.error);
    }

    const { data, error } = await supabase.rpc('manager_account_exists', {
      p_email: validated.value,
    });

    if (error) {
      throw new Error('Could not check your account. Please try again.');
    }

    return { email: validated.value, exists: Boolean(data) };
  };

  /** Manager portal — email + password sign-in for existing accounts. */
  const signInManager = async (email, password, { enforceDomain = true } = {}) => {
    const { email: normalized, exists } = await checkManagerAccountExists(email, { enforceDomain });

    if (!exists) {
      throw new Error(MANAGER_ACCOUNT_NOT_FOUND_MESSAGE);
    }

    return login(normalized, password, 'manager');
  };

  /** Manager portal — send a password reset email (same Send Email hook as signup). */
  const resetManagerPassword = (email, options) => requestManagerPasswordReset(email, options);

  /** Manager portal — passwordless magic link for sign-in (existing accounts). */
  const sendManagerMagicLink = async (email, { enforceDomain = true } = {}) => {
    const supabase = getSupabase();
    if (!supabase) {
      throw new Error(
        'Authentication is not configured. Create frontend/.env.local with VITE_SUPABASE_ANON_KEY, then hard-refresh the page.'
      );
    }

    let allowedDomains;
    if (enforceDomain) {
      allowedDomains = await ensureManagerAllowedDomains();
    }
    const validated = validateManagerEmail(email, { enforceDomain, allowedDomains });
    if (!validated.ok) {
      throw new Error(validated.error);
    }

    await supabase.auth.signOut();
    clearAuthCache();

    const redirectTo = getAuthCallbackUrl();
    const { error } = await supabase.auth.signInWithOtp({
      email: validated.value,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: redirectTo,
      },
    });

    if (error) {
      throw new Error(getOtpFriendlyError(error));
    }

    return { email: validated.value };
  };

  /** Manager portal — register with email + password (one email verify if enabled in Supabase). */
  const registerManager = async (fields, { enforceDomain = true, isHealthFitness = false, isGll = false } = {}) => {
    const supabase = getSupabase();
    if (!supabase) {
      throw new Error(
        'Authentication is not configured. Create frontend/.env.local with VITE_SUPABASE_ANON_KEY, then hard-refresh the page.'
      );
    }

    let allowedDomains;
    if (enforceDomain) {
      allowedDomains = await ensureManagerAllowedDomains();
    }
    const validated = validateManagerSignupFields(fields, { enforceDomain, allowedDomains, isHealthFitness, isGll });
    if (!validated.ok) {
      throw new Error(validated.error);
    }

    const { email, firstName, lastName, club, full_name, password } = validated.value;

    const { exists } = await checkManagerAccountExists(email, { enforceDomain });
    if (exists) {
      throw new Error(MANAGER_ACCOUNT_EXISTS_MESSAGE);
    }

    await supabase.auth.signOut();
    clearAuthCache();

    const redirectTo = getAuthCallbackUrl();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectTo,
        data: {
          firstName,
          lastName,
          club,
          full_name,
          role: 'manager',
        },
      },
    });

    if (error) {
      throw new Error(getSignupFriendlyError(error));
    }

    if (data.user?.identities?.length === 0) {
      try {
        await resendManagerSignupConfirmation(email, { enforceDomain });
        return {
          email,
          full_name,
          club,
          needsConfirmation: true,
        };
      } catch (resendErr) {
        throw new Error(
          resendErr.message?.includes('sign in')
            ? resendErr.message
            : MANAGER_ACCOUNT_EXISTS_MESSAGE,
        );
      }
    }

    if (data.session) {
      const profileData = await fetchUserProfile(data.user.id, {
        accessToken: data.session.access_token,
        email: data.user.email,
      });
      setUser(data.user);
      setSession(data.session);
      applyProfile(setRole, setProfile, profileData);
    }

    return {
      email,
      full_name,
      club,
      needsConfirmation: !data.session,
    };
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        role,
        profile,
        appConfig,
        authReady,
        initializing,
        loading: initializing,
        login,
        signup,
        logout,
        sendAdminMagicLink,
        sendManagerMagicLink,
        checkManagerAccountExists,
        signInManager,
        resetManagerPassword,
        registerManager,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
