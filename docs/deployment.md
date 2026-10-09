# Deployment and operations guide

## Migration order

The deployed database is initialized in this order:

1. `supabase/migrations/20260924150000_create_poker_schema.sql` creates the `rooms`, `room_members`, `rounds`, and `votes` tables plus the room retention trigger.
2. `supabase/migrations/20260924150100_create_poker_policies_and_functions.sql` creates the anonymous-auth RPCs (`create_room`, `join_room`, `submit_vote`, `reveal_round`, `archive_round`, `start_next_round`, `transfer_host`, `leave_room`, `heartbeat_member`) and row-level security policies.
3. `supabase/migrations/20261008000000_enable_poker_realtime.sql` adds `public.rooms`, `public.room_members`, and `public.rounds` to the `supabase_realtime` publication.
4. `20261008144500_add_member_vote_status.sql` adds safe submitted-state markers.
5. `20261008144600_add_round_outcomes_and_atomic_next.sql` adds Notes, outcomes, and atomic round transitions.
6. `20261008144700_revoke_legacy_round_rpcs.sql` removes access to obsolete round mutations.
7. `20261009033000_align_room_host_lock_order.sql` aligns host-operation lock ordering.
8. `20261009061000_enforce_unique_room_nicknames.sql` resolves legacy duplicate names and enforces room-local uniqueness.

Apply all files in `supabase/migrations` in chronological order. `supabase/seed.sql`
is for local development only; do not import local test rooms into production.
For an existing hosted project, use `supabase db push --linked --dry-run` before
`supabase db push --linked`. Never reset a hosted database.

## Anonymous auth and browser environment variables

The browser client uses:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

The Playwright and load-probe scripts load `.env.test` and use:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

The generated URL and anon key must match the same local Supabase project. The scripts validate loopback URLs and require both values before running the end-to-end suite or room load probe.

## Supabase enablement checklist

Before using the app in a real project:

```bash
cp .env.example .env.local
npm install
supabase start
supabase db reset
supabase status
cp .env.example .env.test
vi .env.test
```

In `.env.test`, replace the URL and key placeholders with the local `API URL` and `anon key` printed by `supabase status`. Set `VITE_SUPABASE_URL` and `SUPABASE_URL` to that API URL, and `VITE_SUPABASE_ANON_KEY` and `SUPABASE_ANON_KEY` to that anon key. Use the same values for the `VITE_*` entries in `.env.local` to run the browser app. Do not use the service-role key. The `.env.test` file is ignored by Git; do not add local credentials to tracked files.

Then confirm the following in the Supabase dashboard:

- Authentication > Providers > Anonymous sign-ins is enabled.
- Realtime is available for the project.
- `supabase_realtime` includes the public `rooms`, `room_members`, and `rounds` tables.
- RLS is enabled on the room tables and the RPC access patterns match the membership rules.

## Run E2E and load probe

Both commands read the ignored `.env.test` file automatically:

```bash
npm run test:e2e
npm run probe:room
```

Alternatively, export the values copied from `supabase status` in the current shell, then run the same commands:

```bash
export SUPABASE_URL='<API URL from supabase status>'
export SUPABASE_ANON_KEY='<anon key from supabase status>'
npm run test:e2e
npm run probe:room
```

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

The first release uses **Direct Upload**, not Git-integrated builds. The selected
backend is the existing Poker project in Seoul; no new Singapore project is
created. The Pages project is `poker-planning`, with production branch `main`.
The published trial URL is <https://poker-planning-60a.pages.dev/>.
Account authentication, Supabase organization plan, and the target project must
be confirmed before provisioning or applying migrations.

Log in from your own terminal, without copying administrative tokens into chat:

```sh
npx --yes wrangler@4.149.0 login
npx --offline --yes supabase@2.117.0 login
```

Create an ignored `.env.production.local` containing only browser-safe values:

```dotenv
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<public anon JWT or sb_publishable_ key>
```

Never use a service-role JWT, `sb_secret_` key, database password, or platform
access token in `VITE_*` variables. Keep the local `.env.local` unchanged.

Build and upload from the repository root:

```sh
npm run build:production
npx --yes wrangler@4.149.0 pages deploy dist --project-name poker-planning --branch main --commit-dirty=true
```

`build:production` loads Vite's production environment, refuses loopback/non-HTTPS
or non-hosted Supabase URLs, and rejects private/placeholder client keys before
building. Environment variables can override the ignored file. The checked
values are passed to the build process, so local development settings cannot
replace them. Upload only the resulting `dist`, never the source tree or env
files. Direct Upload environment values are baked in **during the local build**;
changing Pages dashboard variables alone does not update an uploaded bundle.

`wrangler.jsonc` records the Pages project and output directory. Pages provides
SPA fallback when there is no top-level `404.html`, so direct visits to
`/room/<code>` render the React app. Verify this on the live site, not merely at
`/`. Keep asset caching at Pages defaults.

Set hosted Auth's site URL to the production Pages origin and enable anonymous
sign-ins. Do not push the local Supabase config wholesale: it includes
development defaults. A separate minimal config declaring only
`auth.site_url` and `auth.enable_anonymous_sign_ins`, previewed with
`supabase config diff`, leaves undeclared remote settings unchanged.

Direct Upload can be updated manually or from CI, but cannot be converted
in-place to Pages' built-in Git integration. That would require a new Pages
project. This initial upload does not commit or push the working tree.

## Live acceptance and capacity

After publishing, verify independent host/voter/observer sessions, duplicate-name
rejection, share-link routing, browser identity restoration, hidden vote values,
Reveal, saved outcome/Note, and the next round. Use a clearly named disposable
acceptance room; do not modify users' rooms. Production and local origins have
separate browser identities, so a local guest identity does not migrate online.

The initial hosted acceptance passed with three independent browser sessions:
host, voter, and observer. It covered duplicate-name rejection, Realtime
submitted states, hidden vote privacy, reload identity restoration, host rights,
Reveal statistics, saved estimate/Note history, and a second-round Reveal.
The hosted check allows up to 20 seconds for functional assertions; this is not
a response-time target or a 100-member capacity test. Test inputs wait for
autosave to finish before editing disabled controls.

Keep default anonymous-signup rate limits. Consider CAPTCHA/Turnstile before
promoting the URL broadly; anonymous registration can consume project quotas.
Same-IP signup limits can affect a large team behind one NAT. They are separate
from the application's 100-member room limit.

## 100-member local load probe

The repository includes a load probe at `scripts/load-room.mjs` for verifying the room capacity path and realtime propagation. It expects:

```bash
ROOM_CODE=... \
MEMBER_COUNT=100 \
node scripts/load-room.mjs
```

The URL and anon key for this command come from `.env.test` or the exported variables above.

`MEMBER_COUNT` defaults to `100`, and the script is designed to fail if the 101st join is accepted, a hidden vote is exposed before reveal, or the realtime propagation does not reach all 100 members. The script measures join, vote, and Reveal propagation latency and verifies cleanup of channels and sessions.

This probe is a local validation tool and should be reported only as run when the command exits successfully in the current environment. It is not evidence of a live deployed capacity run unless it was executed against the target deployment with a successful exit code.

## Free-tier caveat

Supabase free-tier resource caps and connection limits are not a service-level
agreement. The Free plan currently allows two active projects and may pause a
project after a week of inactivity. See the current
[pricing](https://supabase.com/pricing) and dashboard quotas before each rollout.
Confirm the organization is Free; a project created in a paid organization is
not made free merely by choosing small compute. Do not enable paid add-ons.

This deployment is a team trial, not a production capacity or uptime guarantee.
Multiple rooms share backend quotas. A local 100-member probe is not proof that
several hosted 100-member rooms can run simultaneously. Asia-region placement
does not guarantee fast cross-border access from mainland China; measure from
the team's actual networks. If usage exceeds the free plan, obtain approval
before upgrading or changing the backend.
