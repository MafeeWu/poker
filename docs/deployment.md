# Deployment and operations guide

## Migration order

The deployed database is initialized in this order:

1. `supabase/migrations/20260924150000_create_poker_schema.sql` creates the `rooms`, `room_members`, `rounds`, and `votes` tables plus the room retention trigger.
2. `supabase/migrations/20260924150100_create_poker_policies_and_functions.sql` creates the anonymous-auth RPCs (`create_room`, `join_room`, `submit_vote`, `reveal_round`, `archive_round`, `start_next_round`, `transfer_host`, `leave_room`, `heartbeat_member`) and row-level security policies.
3. `supabase/migrations/20261008000000_enable_poker_realtime.sql` adds `public.rooms`, `public.room_members`, and `public.rounds` to the `supabase_realtime` publication.
4. `supabase/seed.sql` populates the local environment, if needed.

## Anonymous auth and browser environment variables

The browser client uses:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

The local test and probe scripts use:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

The generated URL and anon key must remain in environment variables and must match the same Supabase project. The scripts validate loopback URLs for local development and require both values before running the end-to-end suite or the room load probe.

## Supabase enablement checklist

Before using the app in a real project:

```bash
cp .env.example .env.local
npm install
supabase start
supabase db reset
```

Then confirm the following in the Supabase dashboard:

- Authentication > Providers > Anonymous sign-ins is enabled.
- Realtime is available for the project.
- `supabase_realtime` includes the public `rooms`, `room_members`, and `rounds` tables.
- RLS is enabled on the room tables and the RPC access patterns match the membership rules.

## RLS and Realtime verification

The project includes SQL checks for both policy access and publication coverage:

- `supabase/tests/poker_permissions.sql`
- `supabase/tests/poker_realtime.sql`

Use the local CLI verification step:

```bash
supabase test db
```

The realtime publication intentionally omits individual vote rows so hidden votes remain private until the round is revealed. The room snapshot endpoint returns distribution data only after `revealed` or `archived` status is reached.

## Cloudflare Pages deployment

Set the same variables in Cloudflare Pages for both Preview and Production:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

The Pages build command is:

```bash
npm run build
```

The generated static bundle is written to `dist` and should be published as the Pages artifact.

## 100-member load probe

The repository includes a load probe at `scripts/load-room.mjs` for verifying the room capacity path and realtime propagation. It expects:

```bash
SUPABASE_URL=... \
SUPABASE_ANON_KEY=... \
ROOM_CODE=... \
MEMBER_COUNT=100 \
node scripts/load-room.mjs
```

`MEMBER_COUNT` defaults to `100`, and the script is designed to fail if the 101st join is accepted, a hidden vote is exposed before reveal, or the realtime propagation does not reach all 100 members. The script measures join, vote, and Reveal propagation latency and verifies cleanup of channels and sessions.

This probe is a local validation tool and should be reported only as run when the command exits successfully in the current environment. It is not evidence of a live deployed capacity run unless it was executed against the target deployment with a successful exit code.

## Free-tier caveat

Supabase free-tier resource caps and connection limits are not a service-level agreement. Treat them as a development and demo ceiling rather than a production guarantee. If room traffic or usage exceeds the free plan, use a paid plan or a separate room service to maintain availability and latency.
