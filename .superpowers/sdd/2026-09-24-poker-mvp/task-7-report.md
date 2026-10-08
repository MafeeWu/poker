# Task 7 Fix Report

The requested `task-7-report.md` did not exist in the worktree when this task began, so this file records the complete fix report rather than appending to prior report text.

## Fixes

- Supabase client creation no longer throws during module import when runtime configuration is missing. The app renders a visible configuration error, and API calls still throw an explicit missing-config error instead of returning a successful-looking fallback.
- The E2E preflight reads `.env.test` without turning absent values into the string `"undefined"`, requires a loopback Supabase URL and anon key, and checks the local Auth health endpoint before Playwright starts. The Playwright server no longer reuses an unrelated/stale server.
- Added the brief's room, member count, round status, card, Reveal, final-estimate, distribution, connection, and join-error selectors to the actual components. Copy success and failure are now visible and announced with a status role. Form helper selectors use the labels and controls rendered by the app.
- Replaced hardcoded room codes with rooms created in each test. The capacity fixture creates a real room and 100 separate online anonymous members (one host, 90 voters, nine observers), heartbeats them, attempts the actual 101st join, and disposes its sessions. Browser contexts are isolated and closed in `finally`.
- Rebuilt the load probe around isolated anonymous clients and a generated room. It requires exactly 100 online members and exactly one explicit capacity rejection, checks every member's pre-Reveal snapshot for hidden-vote exposure, confirms every member receives the complete Reveal distribution, and reports average join/vote latency plus maximum Reveal propagation latency. Every created channel is unsubscribed in `finally`, even when subscription, vote, Reveal, or channel cleanup throws; failures are reported and exit nonzero.
- Added an idempotent migration publishing rooms, memberships, and rounds—but not individual votes—to Supabase Realtime. Local Supabase config explicitly enables anonymous sign-ins. Added local setup instructions and regression tests for selectors, preflight, fixture setup, strict counts/outcomes, hidden votes, Reveal fan-out, and cleanup.

## Verification

| Command | Result |
| --- | --- |
| `npm test -- --run` | Passed: 14 test files, 69 tests. |
| `npm test -- --run scripts/load-room.test.mjs` | Passed: 11 deterministic load-probe tests. |
| `npm run build` | Passed: TypeScript build and Vite production build. |
| `npx tsc --ignoreConfig --noEmit --target ES2020 --module ESNext --moduleResolution Bundler --strict --skipLibCheck --esModuleInterop --types node --jsx react-jsx e2e/helpers.ts e2e/home.spec.ts e2e/room.spec.ts e2e/accessibility.spec.ts playwright.config.ts` | Passed: E2E specs, helpers, and Playwright config type-check. |
| `SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=unit-test npx playwright test --list` | Passed: discovered all five E2E tests without executing them. |
| `env -u SUPABASE_URL -u SUPABASE_ANON_KEY -u VITE_SUPABASE_URL -u VITE_SUPABASE_ANON_KEY npm run test:e2e` | Exited `1` immediately with the explicit missing local Supabase configuration message; Playwright did not start. |
| `env -i PATH="$PATH" HOME="$HOME" npm run probe:room` | Exited `1` with the explicit missing `SUPABASE_URL`/`SUPABASE_ANON_KEY` message. |
| `env -i PATH="$PATH" HOME="$HOME" node scripts/load-room.mjs` | Exited `1` with the same explicit missing-runtime-configuration message. |
| `SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=local-test-key npm run test:e2e` | Preflight passed the local Auth health check, then exited `1` immediately because port `4173` is already occupied; it did not reuse that server. |
| `git diff --check` | Passed. |

## Integration limitation

Full browser integration, the live 100-member probe, and `supabase test db` could not be completed: the Supabase CLI and `psql` are unavailable in this environment, the existing local Auth service reported `Anonymous sign-ins are disabled`, and an unrelated process already listens on port `4173`. The code-level and test-harness checks passed; rerun live integration after restarting local Supabase with this worktree's config/migrations and freeing port `4173`.
