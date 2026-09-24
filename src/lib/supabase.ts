import { createClient } from '@supabase/supabase-js';

import type { Database } from './database.types';

function requireEnv(name: string): string {
  const value = import.meta.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing ${name} environment variable`);
  }
  return value;
}

export const supabase = createClient<Database>(
  requireEnv('VITE_SUPABASE_URL'),
  requireEnv('VITE_SUPABASE_ANON_KEY'),
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  },
);
