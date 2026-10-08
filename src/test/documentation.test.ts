import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('documentation requirements', () => {
  it('documents the required Supabase and deployment details', () => {
    const readmePath = resolve(process.cwd(), 'README.md');
    const readme = readFileSync(readmePath, 'utf8');

    expect(readme).toContain('VITE_SUPABASE_URL');
    expect(readme).toContain('VITE_SUPABASE_ANON_KEY');
    expect(readme).toContain('npm run build');
    expect(readme).toContain('dist');
    expect(readme).toContain('supabase db reset');
    expect(readme).toContain('free-tier limits are not an SLA');
  });
});
