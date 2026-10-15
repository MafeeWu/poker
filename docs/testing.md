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

Member cards are 96–144px wide with a 2:3 ratio, without an outer card panel.
Nicknames appear below the cards; a crown identifies the host. Back suits are
derived from random membership UUIDs so they stay consistent across clients,
reloads, and rounds. Online pending voters use coral, submitted votes use
turquoise, and observers use purple. Offline members use gray unless they have
already voted; submitted votes retain turquoise even after disconnecting.
Observers never reveal a vote. Role, connection, and vote-state details are
available to screen readers without visible status labels.

Create and Join show a spinner and pending text during requests, disable form
controls and duplicate submissions, and restore controls after errors without
clearing inputs. Home entry-mode switching is disabled during a pending request.
Reduced-motion preferences suppress spinner and flip animation, not their state.

The room header displays the user-entered room name once as its main title,
without a visible room code or separate name line. Compact connection and share
controls sit at the top right with the existing status/member badges; narrow
screens wrap the header without overflow, including long unbroken room names.
Copy feedback does not shift the controls, and sharing still copies the coded
room URL. Browser fixtures read room codes from the URL, not a visible label.
The current Round heading and status occupy one row immediately above the
felt table, outside its panel.

Selectable-card corner suits are approximately 14px. The header share button
matches the connection badge's height, font size, pill radius, and shadow;
its width accommodates the longer label rather than truncating it.

Room subscriptions send the authenticated member's `heartbeat_member` RPC
immediately after subscribing and every 30 seconds before refreshing the
snapshot. Focus, becoming visible, page restoration, and network recovery
trigger an immediate renewal; simultaneous resume events coalesce. Ordinary
Realtime changes only refresh snapshots and never renew other members or start
heartbeat feedback loops. Closed/error channels reconnect with backoff.
Offline signals pause renewals; results from an older connection generation
cannot restore connection status, publish stale snapshots, or replace a new
connection's error state. Network recovery establishes a fresh subscription and
renews presence before reporting success.
Connection success requires a healthy heartbeat and snapshot on a subscribed
channel; failures stay visible and disable mutations until recovery, which
clears only the connection error, not unrelated action errors.

The server retains its real 90-second last-seen expiry. Closing/unmounting the
room cancels heartbeat timers and browser listeners; no other client keeps a
departed member alive. An OS-suspended or frozen browser cannot send heartbeats
and may expire, then renew automatically when it resumes. The real-browser
presence regression waits 95 seconds without user activity, checks server
last-seen timestamps and online flags, and verifies recovery after a rejected
heartbeat without reloading.

Round history occupies a 280px right-hand sidebar beside the table on desktop,
aligned with the table's top. At viewport widths of 768px or less it follows the
table vertically. Revealed vote statistics remain below the member grid inside
the table; moving history does not change archived estimates or Notes.

Rooms expand to 1400px; the 64×96px voting choices are horizontally centered and
wrap into centered rows on narrow screens. Submitted choices retain their
screen-reader pressed state but no visible selection highlight or lift;
hover and keyboard focus remain available.

Each selectable card shows its value only in the center; the diagonal corners
retain suits without duplicate values. Center values, including special cards,
and revealed member-card values use the former corner's Georgia/serif font.
Room-wide digits in titles, rounds, member names/counts, distribution, estimates,
Notes, and history use local Georgia numeral faces with common serif fallbacks.
Unicode-limited font faces keep nonnumeric text in its existing family, including
the Note field's monospace text; homepage typography is unchanged and no font
download is added. Browser regressions inspect actual rendered fonts as well as
the card structure through reveal and archival.

While votes are hidden, every successful vote or revote triggers a 350ms
member-card shake across room clients, including observers. The existing room channel broadcasts only random
event IDs, member IDs, and round IDs, never vote values. Receivers deduplicate
events and check the current snapshot's round and membership; events received
before the initial or updated round snapshot are validated after it arrives. These public,
cosmetic messages are not proof of sender identity and never change votes,
permissions, or submitted-state indicators. Reduced motion disables shake.
Rejected votes do not shake, reloads do not replay prior events, and animation
delivery failures explicitly distinguish the already-saved vote from the
unsynchronized animation.

The room E2E coverage uses three independent browser sessions to verify safe submitted-state indicators before Show, shown member cards, positive-count distribution labels, unique-plurality and tied estimates, saved Notes, archived history, and the atomic Next round transition. It also checks host/voter vote changes after Show, synchronization to observers, and preservation of the saved outcome. Other checks cover the next round and its Show, reduced-motion output, 320–1440px member-card bounds and name placement, consistent suits, pending entry controls, mobile overflow, and keyboard focus.

`supabase/tests/poker_revotes.sql` checks shown-round votes through the real RPC:
host and voter updates, first-time votes after Show, unchanged final estimate
and Note, updated member cards and distribution, authentication/membership/card
validation, observer restrictions, archival of the updated distribution, and
rejection after archival.

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
