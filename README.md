# Poker MVP

A React + Vite + TypeScript planning poker app that uses Supabase for anonymous guest access, real-time room sync, and secure room membership rules.

## Local setup

```bash
cp .env.example .env.local
npm install
supabase start
supabase db reset
npm run dev
```

The app reads browser environment variables from `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. The local scripts and Playwright checks read `SUPABASE_URL` and `SUPABASE_ANON_KEY`.

## Supabase configuration

1. Start the local Supabase stack with the Supabase CLI.
2. In the Supabase dashboard, enable anonymous sign-ins for Authentication.
3. Copy the generated URL and anon key into your local environment. The values must remain in `.env.local` or the deployment platform's environment settings; do not hardcode them in source files.
4. For Cloudflare Pages, set the same `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` variables in both Preview and Production environment settings.
5. The app expects the project to use the public schema plus the local Supabase Realtime publication for `rooms`, `room_members`, and `rounds`.

## Production build and deployment

Cloudflare Pages should build with:

```bash
npm run build
```

The production output is emitted to the `dist` directory. Keep the same environment values configured for the preview and production deployments; these variables are required in the browser at runtime, and the build itself does not create a fallback configuration.

## Free-tier limits and operational caveat

Supabase free-tier limits are not an SLA and are not a production guarantee. The free plan can hit connection, query, storage, or bandwidth ceilings during demand spikes or sustained usage. If the app reaches those limits, the recovery path is to move the room service to a paid Supabase plan or an alternate service dedicated to the room backend before continuing live usage.

## Verification commands

```bash
npm test -- --run
npm run build
npm run test:e2e
npm run probe:room
```

The end-to-end browser suite and the 100-member room probe require a running local Supabase instance and must be run only with real anonymous auth and Realtime enabled.
