# Poker MVP

A React + Vite + TypeScript planning poker app that uses Supabase for anonymous guest access, real-time room sync, and secure room membership rules.

## Returning to a room

Guest identity is saved in the browser and its access tokens refresh
automatically. Reopen a room's share link or select it from Recent rooms after
refreshing or closing the browser to resume your member, nickname, role, and
current-round vote. Normal tabs in the same browser profile and website origin
share one identity and count as one member in each room.

Another browser, an independent private session, or cleared site data needs to
join as a new member. Nicknames are unique per room (case-insensitive, ignoring
surrounding spaces), and offline members retain their names until leaving.
Knowing a nickname does not authorize taking over that member. Identity lost
before this persistence change cannot be reconstructed from recent-room history.

## Local setup

```bash
cp .env.example .env.local
npm install
supabase start
supabase db reset
npm run dev
```

The app reads browser environment variables from `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. The local scripts and Playwright checks read `SUPABASE_URL` and `SUPABASE_ANON_KEY`.

## Configure local E2E and load-probe environment

The E2E suite and the 100-member probe load `.env.test`; `.env.local` is only for the Vite app and does not configure these Node.js scripts. Start Supabase, inspect its local API URL and anon key, then make a private test-env file from the template:

```bash
supabase start
supabase status
cp .env.example .env.test
vi .env.test
```

In `.env.test`, replace the URL and key placeholders with the `API URL` and `anon key` shown by `supabase status`. Set both `VITE_SUPABASE_URL` and `SUPABASE_URL` to the API URL, and both `VITE_SUPABASE_ANON_KEY` and `SUPABASE_ANON_KEY` to the anon key. Use the same API URL and anon key for the `VITE_*` entries in `.env.local` to run the browser app. Do not use the service-role key. `.env.test` is ignored by Git; keep these local credentials out of tracked files.

With `.env.test` populated, run either or both checks:

```bash
npm run test:e2e
npm run probe:room
```

Alternatively, export the script variables from the same local `supabase status` output before running them:

```bash
export SUPABASE_URL='<API URL from supabase status>'
export SUPABASE_ANON_KEY='<anon key from supabase status>'
npm run test:e2e
npm run probe:room
```

## Supabase configuration

1. Start the local Supabase stack with the Supabase CLI.
2. In the Supabase dashboard, enable anonymous sign-ins for Authentication.
3. Use the generated URL and anon key in `.env.local` for the app and `.env.test` for E2E/probe scripts. Keep these local credentials in ignored env files or deployment platform settings; do not hardcode them in source files.
4. For Cloudflare Pages, set the same `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` variables in both Preview and Production environment settings.
5. The app expects the project to use the public schema plus the local Supabase Realtime publication for `rooms`, `room_members`, and `rounds`.

## Production build and deployment

Cloudflare Pages should build with:

```bash
npm run build
```

The production output is emitted to the `dist` directory. Keep the same environment values configured for the preview and production deployments; these variables are required in the browser at runtime, and the build itself does not create a fallback configuration.

For this project's Direct Upload release, put the hosted project URL and its
public client key in an ignored `.env.production.local`, then run
`npm run build:production`. This guarded build rejects local database endpoints
and secret/service-role keys. Upload `dist` using Wrangler; dashboard environment
variables do not change an already-built bundle. See
[the deployment guide](docs/deployment.md) for login, migration, upload, and
live acceptance steps. No Git commit or push is required for Direct Upload.

## Free-tier limits and operational caveat

Supabase free-tier limits are not an SLA and are not a production guarantee. The free plan can hit connection, query, storage, or bandwidth ceilings during demand spikes or sustained usage. If the app reaches those limits, the recovery path is to move the room service to a paid Supabase plan or an alternate service dedicated to the room backend before continuing live usage.

## Verification commands

```bash
npm test -- --run
npm run build
npm run test:e2e
npm run probe:room
```

The E2E and probe commands above load `.env.test` automatically (or use the exported variables shown in the local E2E and load-probe setup). They require a running local Supabase instance with anonymous auth and Realtime enabled.

For an existing local database, apply additive migrations without resetting data, then check database permissions and concurrent host/round transitions:

```bash
supabase migration up --local
supabase test db
node scripts/check-round-concurrency.mjs
```

The concurrency check uses independent `psql` sessions inside `supabase_db_poker-mvp-local` (override with `POKER_DB_CONTAINER` for another local Supabase container). It coordinates real lock waits for transfer-first, Next-first, and rolled-back host departure, verifies atomic round/host/retry state, and removes only its own fixture rooms. Docker and a running local database are required; no credentials or database reset are needed.

While an outcome save is pending, estimate, Note, and other room mutations are disabled. Failed saves retain the visible draft for retry; clicking Next directly from an edited field submits its latest values atomically instead of starting a competing blur save.
