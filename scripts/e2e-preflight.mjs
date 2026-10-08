import { loadE2EEnv, requireE2EConfig, verifyLocalSupabase } from './supabase-env.mjs';

try {
  loadE2EEnv();
  await verifyLocalSupabase(requireE2EConfig());
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
