# Local integration testing

The browser integration suite and the 100-member room probe require a running local Supabase instance. They use real anonymous auth, database RPCs, and Realtime; the integration suite does not replace those services with success mocks. The migrations publish room, membership, and round changes to Realtime, but deliberately do not publish individual vote rows.

1. Install the Supabase CLI and start the local stack from the repository root:

   ```sh
   supabase start
   supabase db reset
   supabase status -o env
   ```

2. Copy the local API URL and anon key reported by `supabase status -o env` into an ignored `.env.test` file:

   ```dotenv
   SUPABASE_URL=http://127.0.0.1:54321
   SUPABASE_ANON_KEY=<local anon key from supabase status>
   VITE_SUPABASE_URL=http://127.0.0.1:54321
   VITE_SUPABASE_ANON_KEY=<same local anon key>
   ```

   `.env.test` is ignored by Git. The E2E preflight requires a loopback URL, validates both variables, and verifies the local Auth health endpoint before Playwright starts the Vite server.

3. Run the checks:

   ```sh
   npm test -- --run
   supabase test db
   npm run build
   npm run test:e2e
   npm run probe:room
   ```

The load probe creates a new room with one host, 90 voters, and 9 observers; it requires all 100 memberships to be online before attempting the 101st join. `MEMBER_COUNT` must be `100` (or omitted, which defaults to `100`). `ROOM_CODE` is an optional assertion against the generated code, not a seed code or a room the probe tries to find. The probe fails unless the 101st join is rejected specifically for capacity, all members receive Reveal, no pre-Reveal snapshot exposes a distribution, and every channel/session is cleaned up.
