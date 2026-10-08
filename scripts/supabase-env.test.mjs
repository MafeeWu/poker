import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadE2EEnv, requireE2EConfig, verifyLocalSupabase } from './supabase-env.mjs';

describe('E2E Supabase preflight', () => {
  let directory;

  afterEach(() => {
    if (directory) {
      rmSync(directory, { recursive: true, force: true });
      directory = undefined;
    }
  });

  it('fails with an explicit list of missing Supabase variables', () => {
    expect(() => requireE2EConfig({})).toThrow(/Missing Supabase configuration: SUPABASE_URL, SUPABASE_ANON_KEY/i);
  });

  it('requires a loopback Supabase URL for E2E runs', () => {
    expect(() => requireE2EConfig({
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_ANON_KEY: 'anon-key',
    })).toThrow(/require local Supabase/i);
  });

  it('fails clearly when the local Supabase API is not responsive', async () => {
    const config = { url: 'http://127.0.0.1:54321', anonKey: 'anon-key' };
    const fetchImpl = async () => {
      throw new Error('connection refused');
    };

    await expect(verifyLocalSupabase(config, { fetchImpl, timeoutMs: 50 }))
      .rejects.toThrow(/Local Supabase is unavailable.*supabase start/i);
  });

  it('accepts the local Supabase health endpoint', async () => {
    let requestedUrl;
    let requestOptions;
    await verifyLocalSupabase(
      { url: 'http://127.0.0.1:54321', anonKey: 'anon-key' },
      { fetchImpl: async (url, options) => {
        requestedUrl = url.toString();
        requestOptions = options;
        return { ok: true };
      } },
    );
    expect(requestedUrl).toBe('http://127.0.0.1:54321/auth/v1/health');
    expect(requestOptions.headers).toEqual({ apikey: 'anon-key' });
  });

  it('does not synthesize the string "undefined" when no env values exist', () => {
    directory = mkdtempSync(path.join(tmpdir(), 'poker-empty-env-'));
    const env = {};

    loadE2EEnv({ env, envFile: path.join(directory, '.env.test') });

    expect(env.SUPABASE_URL).toBeUndefined();
    expect(env.SUPABASE_ANON_KEY).toBeUndefined();
    expect(() => requireE2EConfig(env)).toThrow(/Missing Supabase configuration/i);
  });

  it('loads local E2E configuration and preserves explicit environment overrides', () => {
    directory = mkdtempSync(path.join(tmpdir(), 'poker-e2e-env-'));
    const envFile = path.join(directory, '.env.test');
    writeFileSync(envFile, 'VITE_SUPABASE_URL=http://127.0.0.1:54321\nVITE_SUPABASE_ANON_KEY=file-key\n');
    const env = { VITE_SUPABASE_ANON_KEY: 'process-key' };

    loadE2EEnv({ env, envFile });

    expect(env.SUPABASE_URL).toBe('http://127.0.0.1:54321');
    expect(env.SUPABASE_ANON_KEY).toBe('process-key');
    expect(requireE2EConfig(env)).toEqual({
      url: 'http://127.0.0.1:54321',
      anonKey: 'process-key',
    });
  });

  it('exits before Playwright startup when no local Supabase configuration exists', () => {
    directory = mkdtempSync(path.join(tmpdir(), 'poker-e2e-preflight-'));
    const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'e2e-preflight.mjs');
    const result = spawnSync(process.execPath, [script], {
      cwd: directory,
      encoding: 'utf8',
      env: {
        ...process.env,
        SUPABASE_URL: '',
        SUPABASE_ANON_KEY: '',
        VITE_SUPABASE_URL: '',
        VITE_SUPABASE_ANON_KEY: '',
      },
    });

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toMatch(/running local Supabase instance/i);
    expect(`${result.stdout}${result.stderr}`).toMatch(/SUPABASE_URL, SUPABASE_ANON_KEY/i);
  });
});
