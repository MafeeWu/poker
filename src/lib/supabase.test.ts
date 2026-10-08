import { describe, expect, it } from 'vitest';
import { getSupabaseConfigError } from './supabase';

describe('Supabase runtime configuration', () => {
  it('diagnoses missing URL and anon key without throwing during module import', async () => {
    await expect(import('./supabase')).resolves.toHaveProperty('getSupabaseClient');
    expect(getSupabaseConfigError({})).toBe(
      'Missing Supabase configuration: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY.',
    );
  });

  it('accepts complete runtime configuration', () => {
    expect(getSupabaseConfigError({
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_SUPABASE_ANON_KEY: 'local-anon-key',
    })).toBeNull();
  });

  it('diagnoses malformed Supabase URLs without constructing a client', () => {
    expect(getSupabaseConfigError({
      VITE_SUPABASE_URL: 'not a URL',
      VITE_SUPABASE_ANON_KEY: 'local-anon-key',
    })).toBe('VITE_SUPABASE_URL must be a valid HTTP or HTTPS URL.');
  });
});
