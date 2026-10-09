# Local integration testing

The E2E suite and room-capacity probe require a running local Supabase instance and an ignored `.env.test` file. They use real anonymous auth, database RPCs, and Realtime; the integration suite does not replace those services with success mocks. Room and membership changes are published to Realtime, but individual vote rows are not.

Anonymous guest sessions persist in browser local storage and automatically
refresh their access tokens. Normal tabs on the same origin share one identity:
reloading, reopening the browser, or following a share/recent-room link restores
the same member, nickname, role, and current-round vote without adding a member.
Returning through the home Join form also restores the member rather than
renaming it or replacing its role with the form selection.

Restoration looks up the room using authenticated RLS, not cached member IDs or
nicknames, and works even when the room is outside the five-item recent history.
A returning member sends a heartbeat before loading the latest snapshot.
Simultaneous first-use tabs serialize session creation using Web Locks, with
in-page request coalescing when Web Locks are unavailable.

A different browser/profile, independent private session, or cleared site data
requires joining as a new member. A stale recent-room entry without valid
membership shows the explicit join form, not `Membership required` with a
permanently loading room. Real network/auth errors stay visible. Sessions lost
under the old page-only version cannot be recovered from a nickname or history.
Treat persisted auth data as credentials; do not copy it into another user's
browser, logs, or shared files.

Browser regressions cover host reload, a real Chromium profile close/relaunch
with voter recovery, same-browser tabs and missing recent history, access-token
refresh, simultaneous initial signups, home-form returning members, and isolated
sessions with history but no credentials.

Nicknames are unique per room after trimming surrounding spaces and ignoring
case, across hosts, voters, and observers. Offline memberships still reserve
their names; explicitly leaving releases the name. Returning with the original
browser identity restores the member instead of reserving a second name.
Without that identity, the old name cannot be claimed while its membership
remains. Duplicate-name errors preserve the join form so users can retry.
Database and browser regressions cover duplicate inserts/renames, independent
rooms, offline names, explicit leaving, and simultaneous same-name joins.

The nickname migration keeps the earliest member's name (breaking timestamp
ties by member ID) and gives subsequent duplicates the first available numeric
suffix starting at `(2)`. Existing suffixed names are not overwritten, and no
members, roles, host references, or votes are removed. Its rollback-only fixture
check runs against the real migration:

```sh
node scripts/check-nickname-migration.mjs
```

The room E2E coverage uses three independent browser sessions to verify safe submitted-state indicators before Reveal, revealed member cards, positive-count distribution labels, unique-plurality and tied estimates, saved Notes, archived history, and the atomic Next round transition. It also checks the next round and its Reveal, reduced-motion output, mobile overflow, and keyboard focus.

1. Start the local stack and inspect its local API URL and anon key without resetting the database:

   ```sh
   npx --offline --yes supabase@2.117.0 start
   npx --offline --yes supabase@2.117.0 status -o env
   ```

2. Copy the local API URL and anon key into an ignored `.env.test` file:

   ```dotenv
   SUPABASE_URL=http://127.0.0.1:54321
   SUPABASE_ANON_KEY=<local anon key from supabase status>
   VITE_SUPABASE_URL=http://127.0.0.1:54321
   VITE_SUPABASE_ANON_KEY=<same local anon key>
   ```

   The E2E preflight requires a loopback URL, validates the configuration, and checks the local Auth health endpoint before Playwright starts its temporary Vite server. The room-capacity probe reads the same `.env.test` configuration.

3. Apply pending migrations and run the checks from the repository root:

   ```bash
   npx --offline --yes supabase@2.117.0 migration up --local
   npx --offline --yes supabase@2.117.0 test db --local
   npm test -- --run
   npm run build
   npm run test:e2e
   npm run probe:room
   ```

The load probe creates a room with one host, 90 voters, and 9 observers, verifies that all 100 memberships are online, and then attempts a 101st join. It must continue to admit 100 members, reject the 101st specifically for capacity, receive Reveal on all member channels, withhold the distribution before Reveal, and report zero failed operations. The probe is a local integration/load check, not a hosted production SLA claim. `MEMBER_COUNT` must be `100` (or omitted, which defaults to `100`). `ROOM_CODE` optionally asserts the generated code; it is not a seed code or a room the probe tries to find.
