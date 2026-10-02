import { createClient } from '@supabase/supabase-js';

function readEnv() {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
  return { supabaseUrl, supabaseAnonKey };
}

export function isSupabaseConfigured() {
  const { supabaseUrl, supabaseAnonKey } = readEnv();
  return Boolean(supabaseUrl && supabaseAnonKey);
}

export const SUPABASE_AUTH_STORAGE_KEY = 'powermusic-auth';

let client = null;

/** Lazy client — avoids a stale `null` when .env.local is added without a full reload. */
export function getSupabase() {
  const { supabaseUrl, supabaseAnonKey } = readEnv();
  if (!supabaseUrl || !supabaseAnonKey) {
    if (import.meta.env.DEV) {
      console.warn(
        'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in frontend/.env.local, then restart Vite.'
      );
    }
    return null;
  }
  if (!client) {
    client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        storageKey: SUPABASE_AUTH_STORAGE_KEY,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}

/** @deprecated use getSupabase() */
export const supabase = new Proxy(
  {},
  {
    get(_target, prop) {
      const sb = getSupabase();
      if (!sb) return undefined;
      const value = sb[prop];
      return typeof value === 'function' ? value.bind(sb) : value;
    },
  },
);
