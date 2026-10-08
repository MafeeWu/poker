import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('documentation requirements', () => {
  it('documents local test environment setup and deployment details', () => {
    const readmePath = resolve(process.cwd(), 'README.md');
    const readme = readFileSync(readmePath, 'utf8');
    const deployment = readFileSync(resolve(process.cwd(), 'docs/deployment.md'), 'utf8');
    const gitignore = readFileSync(resolve(process.cwd(), '.gitignore'), 'utf8');

    expect(readme).toContain('VITE_SUPABASE_URL');
    expect(readme).toContain('VITE_SUPABASE_ANON_KEY');
    expect(readme).toContain('npm run build');
    expect(readme).toContain('dist');
    expect(readme).toContain('supabase db reset');
    expect(readme).toContain('free-tier limits are not an SLA');
    expect(readme).toContain('cp .env.example .env.test');
    expect(readme).toContain('supabase status');
    expect(readme).toContain('Set both `VITE_SUPABASE_URL` and `SUPABASE_URL` to the API URL');
    expect(readme).toContain('both `VITE_SUPABASE_ANON_KEY` and `SUPABASE_ANON_KEY` to the anon key');
    expect(readme).toContain('npm run test:e2e');
    expect(readme).toContain('npm run probe:room');
    expect(deployment).toContain('cp .env.example .env.test');
    expect(deployment).toContain('supabase status');
    expect(deployment).toContain('Set `VITE_SUPABASE_URL` and `SUPABASE_URL` to that API URL');
    expect(deployment).toContain('`VITE_SUPABASE_ANON_KEY` and `SUPABASE_ANON_KEY` to that anon key');
    expect(deployment).toContain('npm run test:e2e');
    expect(deployment).toContain('npm run probe:room');
    expect(gitignore).toContain('.env.*');
    expect(gitignore).toContain('!.env.example');
  });
});
