export function loadE2EEnv(options?: { env?: NodeJS.ProcessEnv; envFile?: string }): NodeJS.ProcessEnv;
export function requireE2EConfig(env?: NodeJS.ProcessEnv): { url: string; anonKey: string };
export function verifyLocalSupabase(
  config: { url: string; anonKey: string },
  options?: { fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<void>;
