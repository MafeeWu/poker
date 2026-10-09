import { describe, expect, it } from 'vitest';
import { requireProductionConfig } from './build-production.mjs';

const projectUrl = 'https://abcdefghijklmnopqrst.supabase.co';
const anonKey = [
  Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
  Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url'),
  'test-signature',
].join('.');

describe('production build configuration', () => {
  it('rejects missing configuration before building deployable assets', () => {
    expect(() => requireProductionConfig({})).toThrow(/VITE_SUPABASE_URL.*VITE_SUPABASE_ANON_KEY/);
  });

  it.each([
    'http://127.0.0.1:54321',
    'https://localhost:54321',
    'http://abcdefghijklmnopqrst.supabase.co',
    'https://abcdefghijklmnopqrst.supabase.co/unexpected-path',
    'https://user:password@abcdefghijklmnopqrst.supabase.co',
    'not a URL',
  ])('rejects local or malformed production endpoints: %s', (url) => {
    expect(() => requireProductionConfig({
      VITE_SUPABASE_URL: url,
      VITE_SUPABASE_ANON_KEY: anonKey,
    })).toThrow(/hosted Supabase HTTPS/);
  });

  it.each(['sb_secret_do-not-publish', 'replace-with-local-anon-key', ''])('rejects private or placeholder keys', (key) => {
    expect(() => requireProductionConfig({
      VITE_SUPABASE_URL: projectUrl,
      VITE_SUPABASE_ANON_KEY: key,
    })).toThrow(/VITE_SUPABASE_ANON_KEY/);
  });

  it('rejects a service-role JWT without exposing it in the error', () => {
    const secretKey = anonKey.replace(
      Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url'),
      Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url'),
    );
    expect(() => requireProductionConfig({
      VITE_SUPABASE_URL: projectUrl,
      VITE_SUPABASE_ANON_KEY: secretKey,
    })).toThrow(/public anon or publishable key/);
    try {
      requireProductionConfig({ VITE_SUPABASE_URL: projectUrl, VITE_SUPABASE_ANON_KEY: secretKey });
    } catch (error) {
      expect(error.message).not.toContain(secretKey);
    }
  });

  it.each([anonKey, 'sb_publishable_public-test-key'])('accepts a hosted project with a public client key', (key) => {
    expect(requireProductionConfig({
      VITE_SUPABASE_URL: ` ${projectUrl} `,
      VITE_SUPABASE_ANON_KEY: ` ${key} `,
    })).toEqual({ VITE_SUPABASE_URL: projectUrl, VITE_SUPABASE_ANON_KEY: key });
  });
});
