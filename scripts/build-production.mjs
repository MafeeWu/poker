import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { loadEnv } from 'vite';

export function requireProductionConfig(env) {
  const missing = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']
    .filter((name) => !env[name]?.trim());
  if (missing.length) {
    throw new Error(`Missing production configuration: ${missing.join(', ')}. Configure .env.production.local.`);
  }

  let url;
  try {
    url = new URL(env.VITE_SUPABASE_URL.trim());
  } catch {
    throw new Error('VITE_SUPABASE_URL must be a hosted Supabase HTTPS project URL.');
  }
  if (url.protocol !== 'https:' || !/^[a-z]{20}\.supabase\.co$/.test(url.hostname)
    || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('VITE_SUPABASE_URL must be a hosted Supabase HTTPS project URL.');
  }

  const key = env.VITE_SUPABASE_ANON_KEY.trim();
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
    let payload;
    try {
      const parts = key.split('.');
      if (parts.length !== 3) {
        throw new Error('Invalid JWT structure');
      }
      payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch {
      throw new Error('VITE_SUPABASE_ANON_KEY must be a public anon or publishable key, never a secret/service-role key.');
    }
    if (payload?.role !== 'anon') {
      throw new Error('VITE_SUPABASE_ANON_KEY must be a public anon or publishable key, never a secret/service-role key.');
    }
  }

  return { VITE_SUPABASE_URL: url.origin, VITE_SUPABASE_ANON_KEY: key };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = requireProductionConfig(loadEnv('production', process.cwd(), 'VITE_'));
    const result = spawnSync('npm', ['run', 'build'], {
      stdio: 'inherit',
      env: { ...process.env, ...config },
    });
    if (result.error) {
      throw result.error;
    }
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Production build failed.');
    process.exitCode = 1;
  }
}
