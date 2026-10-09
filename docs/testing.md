# Local integration testing

The E2E suite and room-capacity probe require a running local Supabase instance and an ignored `.env.test` file. They use real anonymous auth, database RPCs, and Realtime; the integration suite does not replace those services with success mocks. Room and membership changes are published to Realtime, but individual vote rows are not.

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
