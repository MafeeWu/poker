import { createClient } from '@supabase/supabase-js';

import type { Database } from './database.types';

export type SupabaseRuntimeEnv = {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
};

export function getSupabaseConfigError(env: SupabaseRuntimeEnv = {
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
}): string | null {
  const url = env.VITE_SUPABASE_URL?.trim();
  const anonKey = env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) {
    const missing = [
      !url ? 'VITE_SUPABASE_URL' : null,
      !anonKey ? 'VITE_SUPABASE_ANON_KEY' : null,
    ].filter((name) => name !== null);
    return `Missing Supabase configuration: ${missing.join(', ')}.`;
  }

  try {
    const protocol = new URL(url).protocol;
    if (protocol !== 'http:' && protocol !== 'https:') {
      return 'VITE_SUPABASE_URL must use HTTP or HTTPS.';
    }
  } catch {
    return 'VITE_SUPABASE_URL must be a valid HTTP or HTTPS URL.';
  }

  return null;
}

const configError = getSupabaseConfigError();
const supabaseClient = configError
  ? null
  : createClient<Database>(
      import.meta.env.VITE_SUPABASE_URL.trim(),
      import.meta.env.VITE_SUPABASE_ANON_KEY.trim(),
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
      },
    );

export function getSupabaseClient() {
  if (!supabaseClient) {
    throw new Error(`${configError} Configure local Supabase before using Poker.`);
  }
  return supabaseClient;
}
