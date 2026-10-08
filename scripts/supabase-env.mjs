import fs from 'node:fs';
import path from 'node:path';

function readValue(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function loadE2EEnv({ env = process.env, envFile = path.resolve(process.cwd(), '.env.test') } = {}) {
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
        continue;
      }
      const separator = trimmed.indexOf('=');
      const key = trimmed.slice(0, separator).trim();
      const value = readValue(trimmed.slice(separator + 1));
      if (key && (env[key] === undefined || env[key] === '')) {
        env[key] = value;
      }
    }
  }

  if (!env.SUPABASE_URL && env.VITE_SUPABASE_URL) {
    env.SUPABASE_URL = env.VITE_SUPABASE_URL;
  }
  if (!env.SUPABASE_ANON_KEY && env.VITE_SUPABASE_ANON_KEY) {
    env.SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY;
  }
  if (!env.VITE_SUPABASE_URL && env.SUPABASE_URL) {
    env.VITE_SUPABASE_URL = env.SUPABASE_URL;
  }
  if (!env.VITE_SUPABASE_ANON_KEY && env.SUPABASE_ANON_KEY) {
    env.VITE_SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY;
  }
  return env;
}

export function requireE2EConfig(env = process.env) {
  const missing = [
    ['SUPABASE_URL', env.SUPABASE_URL || env.VITE_SUPABASE_URL],
    ['SUPABASE_ANON_KEY', env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY],
  ].filter(([, value]) => !value || !String(value).trim()).map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(
      `E2E tests require a running local Supabase instance. Missing Supabase configuration: ${missing.join(', ')}. Run "supabase start" and set SUPABASE_URL and SUPABASE_ANON_KEY (or VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY) in .env.test.`,
    );
  }

  const url = String(env.SUPABASE_URL || env.VITE_SUPABASE_URL).trim();
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error('E2E tests require local Supabase. SUPABASE_URL must be a valid local HTTP URL.');
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('E2E tests require local Supabase. SUPABASE_URL must use HTTP or HTTPS.');
  }
  const hostname = parsedUrl.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!['127.0.0.1', 'localhost', '::1'].includes(hostname)) {
    throw new Error(`E2E tests require local Supabase. SUPABASE_URL must point to loopback, not ${hostname}.`);
  }

  return {
    url,
    anonKey: String(env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY).trim(),
  };
}

export async function verifyLocalSupabase(config, { fetchImpl = fetch, timeoutMs = 1_500 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const healthUrl = new URL('/auth/v1/health', config.url);
  try {
    const response = await fetchImpl(healthUrl, {
      headers: { apikey: config.anonKey },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`health endpoint returned HTTP ${response.status}`);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Local Supabase is unavailable at ${healthUrl}. Run "supabase start" before integration tests. ${reason}`);
  } finally {
    clearTimeout(timeout);
  }
}
