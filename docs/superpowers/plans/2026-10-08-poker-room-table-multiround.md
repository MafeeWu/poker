# Poker Room Table and Multi-Round Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the Poker room as a multiplayer card table, show safe live voting status and revealed member cards, accurately display vote counts, and let the host save an editable estimate and Note while atomically starting the next round.

**Architecture:** Additive Postgres migrations will publish only a per-member vote-submitted marker, expose member card values only after Reveal, persist a bounded Note, and provide host-only round-outcome and atomic next-round RPCs. Typed client snapshots and focused React components will render the table, member states, distribution, editable outcome, and recent history. Playwright and pgTAP will cover synchronization, privacy, multi-round behavior, and the existing 100-member boundary.

**Tech Stack:** React, TypeScript, Vite, Supabase Postgres/RLS/RPC/Realtime, Vitest, React Testing Library, Playwright, pgTAP.

**Spec:** `docs/superpowers/specs/2026-10-08-poker-room-table-multiround-design.md`

**Execution status:** All six tasks and final review fixes completed locally on
2026-10-09. The checkboxes below describe the original implementation procedure;
completion evidence and deviations are summarized here.

| Deliverable | Implementation |
|---|---|
| Safe member vote status | `f7294f7`, `d2c02f3` |
| Notes and atomic round RPCs | `262cdbf` |
| Typed snapshots and client RPCs | `9738339` |
| Member table and positive-count chart | `2b6d00b` |
| Outcome controls, host voting, and history | `4ae889e` |
| Multiplayer, two-round, accessibility, and capacity checks | `e67e2d7`, `ce087c0`, `9a8bfe8` |
| Autosave/pending, Realtime ordering, lock ordering, and reveal animation fixes | `c11a5bb` |

Final local verification: 125 unit tests, 71 database assertions, all seven browser
cases, three independent-session concurrency schedules, production build, and a
capacity probe admitting 100 members and rejecting member 101. No deployment or
hosted SLA is asserted.

Execution adjustments: legacy RPC revocation was deferred until the client
switched; the first three-client round exercises a unique plurality and the
second a tie; commits staged only their actual changes. Final review also added
serialized/coalesced snapshot refreshes and an additive room-first lock-order
migration. Existing approved visual work remained preserved and unstaged.

The original reported two-member symptom remains unexplained: concurrent-join
regression runs pass, but an earlier timeout had no retained diagnostic trace.
Automatic host promotion on departure is an unrelated pre-existing issue and
was not changed; explicit host transfer remains supported.

## Global Constraints

- A room supports at most 100 online members; do not raise this limit.
- The only voting deck is Fibonacci: `0, ½, 1, 2, 3, 5, 8, 13, 21, 34, 55, ∞, ?`.
- Votes stay hidden until the host reveals them.
- Results show vote distribution and the host-editable final estimate, never average or median.
- The round state machine remains `voting -> revealed -> archived`.
- A room retains the most recent 20 archived rounds.
- Notes are plain text, optional, and limited to 240 characters.
- Only room members can read room state; only the host can edit round outcome or advance a round.
- Never publish individual vote values to Realtime before Reveal; keep the `votes` table out of the Realtime publication.
- Add database migrations after existing migrations; never rewrite applied migration files or run a destructive database reset.
- Preserve accessible text/icon status, keyboard focus, and `prefers-reduced-motion` behavior.
- Preserve the approved arcade visual system and all pre-existing uncommitted changes; do not reset or overwrite the current working tree. Before staging any path that already contains arcade-style edits, inspect its diff and include those edits only when they are part of the intended table styling; do not stage unrelated changes.

## Review Focus

- **Hidden-vote leakage:** snapshots or Realtime updates must not expose another member's vote value before Reveal. Pin this with SQL snapshot assertions in Task 1 and browser assertions in Task 6.
- **Host/voter count mismatch:** hosts are eligible voters, while observers are not. Pin this with SQL role counts in Task 1 and host/voter/observer cards in Tasks 4 and 6.
- **Duplicate or stale next-round requests:** concurrent or repeated calls must not create a second next round or overwrite a completed result. Pin this with transactional pgTAP cases in Task 2.
- **Plurality edge cases:** ties, zero votes, and distribution entries with zero counts must not produce a false estimate or visible zero-height category. Pin this with domain and chart tests in Task 4 and outcome tests in Task 5.
- **Note and client validation boundaries:** 240 Unicode characters are accepted, 241 are rejected, and an unsaved host draft must not be lost on Realtime refresh or failed transition. Pin this with SQL/API tests in Tasks 2-3 and outcome-form tests in Task 5.

---

## File Map

| File | Responsibility in this plan |
|---|---|
| `supabase/migrations/20261008144500_add_member_vote_status.sql` | Add the safe current-round vote marker and replace the snapshot/vote RPC implementations to return per-member status and post-Reveal cards. |
| `supabase/migrations/20261008144600_add_round_outcomes_and_atomic_next.sql` | Persist round notes; add host-only outcome update and atomic archive/start-next RPCs. |
| `supabase/migrations/20261008144700_revoke_legacy_round_rpcs.sql` | Remove authenticated access to the former two-call archive/next-round RPCs after the UI switches to the atomic flow. |
| `supabase/tests/poker_permissions.sql` | Assert host/voter/observer eligibility, hidden card values, revealed member values, host authorization, Note validation, and atomic round transitions. |
| `supabase/tests/poker_realtime.sql` | Keep `room_members` and `rounds` in the publication and `votes` excluded. |
| `src/lib/database.types.ts` | Describe the new member/round snapshot fields and RPC contracts. |
| `src/lib/roomApi.ts` | Validate and normalize the new snapshot fields and expose typed outcome/next-round RPCs. |
| `src/lib/roomApi.test.ts` | Pin snapshot privacy validation and RPC arguments/errors. |
| `src/lib/roomSync.test.ts` | Verify a `room_members` status update triggers an authoritative snapshot refresh. |
| `src/domain/roundOutcome.ts` | Purely derive unique plurality, tie, or no-vote final-estimate state. |
| `src/domain/roundOutcome.test.ts` | Cover unique plurality, ties, and empty distributions. |
| `src/features/room/MemberGrid.tsx` | Render every room member inside the table with vote-state backgrounds and post-Reveal cards. |
| `src/features/room/MemberGrid.test.tsx` | Verify host/voter/observer states, hidden cards, revealed cards, and large member lists. |
| `src/features/room/VoteDistribution.tsx` | Render positive-count bars and exact counts below each bar. |
| `src/features/room/VoteDistribution.test.tsx` | Verify zeros are omitted and bars expose correct counts. |
| `src/features/room/RoundBoard.tsx` | Retain current-round/status summary without owning the distribution's placement. |
| `src/features/room/RoundHistory.tsx` | Show archived estimate and Note for the most recent rounds. |
| `src/features/room/RoundHistory.test.tsx` | Verify history order, estimate, Note, and empty history. |
| `src/features/room/RoundOutcomeForm.tsx` | Let the host review/edit the estimate and Note, save edits, and request Next round. |
| `src/features/room/RoundOutcomeForm.test.tsx` | Verify seeded estimate, tie/no-vote requirements, Note length, save, and transition states. |
| `src/features/room/HostControls.tsx` | Keep reveal/host-transfer controls and compose the outcome form; remove the separate Archive button. |
| `src/features/room/RoomPage.tsx` | Include hosts in voting, render table sections in the required order, and connect typed outcome/next-round actions. |
| `src/features/room/RoomPage.test.tsx` | Update shared snapshots and verify role permissions and table ordering. |
| `src/app/app.css` | Add arcade member-grid, status-state, chart, history, and responsive styles without discarding the existing arcade styling. |
| `e2e/room.spec.ts` | Cover three independent members, vote-state synchronization, reveal cards, chart, outcome, history, and next-round flow. |
| `e2e/accessibility.spec.ts` | Verify revealed member cards and result information remain available with reduced motion and keyboard navigation. |
| `docs/testing.md` | Document the updated local database, E2E, and capacity verification sequence. |

## Task 1: Publish safe per-member vote status and revealed cards

**Files:**
- Create: `supabase/migrations/20261008144500_add_member_vote_status.sql`
- Modify: `supabase/tests/poker_permissions.sql`
- Modify: `supabase/tests/poker_realtime.sql`

**Interfaces:**
- Consumes: existing `room_members`, `rounds`, `votes`, `build_room_snapshot(uuid, uuid)`, and `submit_vote(uuid, uuid, text)`.
- Produces: `room_members.last_voted_round_id uuid NULL`; snapshot member fields `hasVoted: boolean` and `vote: VoteValue | null`; a `room_members` UPDATE after a successful vote that causes subscribed clients to refresh.

- [ ] **Step 1: Add failing pgTAP assertions for pre-Reveal member status**

In `supabase/tests/poker_permissions.sql`, extend the existing host-vote case. After host user A submits `3`, assert that the snapshot returned to a different room member marks A as having voted but returns no member card value while status is `voting`. Keep the existing raw-vote RLS assertions.

```sql
SELECT is(
  (
    SELECT member->>'hasVoted'
    FROM jsonb_array_elements(
      build_room_snapshot(
        (SELECT room_id FROM poker_test_state),
        '22222222-2222-4222-8222-222222222222'::uuid
      )->'members'
    ) AS member
    WHERE member->>'id' = (SELECT user_a_member_id::text FROM poker_test_state)
  ),
  'true',
  'another member can see that the host voted'
);

SELECT is(
  (
    SELECT member->>'vote'
    FROM jsonb_array_elements(
      build_room_snapshot(
        (SELECT room_id FROM poker_test_state),
        '22222222-2222-4222-8222-222222222222'::uuid
      )->'members'
    ) AS member
    WHERE member->>'id' = (SELECT user_a_member_id::text FROM poker_test_state)
  ),
  NULL,
  'another member cannot see the host card before reveal'
);
```

Add an assertion immediately after submission that A's `room_members.last_voted_round_id` equals the current round ID. Add matching assertions after Reveal: A's member entry returns `3`, and an observer still has `hasVoted = false` and `vote = null`. These six new assertions (two before Reveal, one marker assertion, and three after Reveal) change `SELECT plan(18)` to `SELECT plan(24)`.

- [ ] **Step 2: Run the database tests to verify the new assertions fail**

Run: `npx --offline --yes supabase@2.117.0 test db --local`

Expected: the existing suite still runs, and the new assertions fail because the current snapshot has no per-member `hasVoted` or `vote` fields.

- [ ] **Step 3: Add the safe Realtime marker and replace the two RPC definitions**

Create the migration in a transaction. Add a nullable marker referencing the current/archived round; deleting an old round must clear the marker rather than deleting its member:

```sql
ALTER TABLE public.room_members
  ADD COLUMN last_voted_round_id uuid
  REFERENCES public.rounds(id)
  ON DELETE SET NULL;
```

Copy `build_room_snapshot` and `submit_vote` into the new migration as `CREATE OR REPLACE FUNCTION` definitions. In `submit_vote`, update `last_voted_round_id` to the accepted `v_round.id` in the same transaction after the vote upsert. In `build_room_snapshot`, derive `hasVoted` from whether a vote exists for the current round; return each member's vote only when the current round status is `revealed` or `archived`, otherwise return JSON null. Continue returning `myVote` only to the authenticated caller. Do not add `votes` to the publication.

- [ ] **Step 4: Apply the migration and run the SQL tests**

Run:

```bash
npx --offline --yes supabase@2.117.0 migration up --local
npx --offline --yes supabase@2.117.0 test db --local
```

Expected: all pgTAP assertions pass without resetting the local database.

- [ ] **Step 5: Assert the safe Realtime publication contract**

In `supabase/tests/poker_realtime.sql`, retain the assertions that `rooms`, `room_members`, and `rounds` are published and `votes` is not. Update the plan count only if an assertion is added. Run the database test command again and confirm both SQL files pass.

- [ ] **Step 6: Commit the member-status migration and SQL tests**

```bash
git add supabase/migrations/20261008144500_add_member_vote_status.sql supabase/tests/poker_permissions.sql supabase/tests/poker_realtime.sql
git commit -m "feat(db): publish safe poker vote status"
```

## Task 2: Persist round notes and add atomic next-round RPCs

**Files:**
- Create: `supabase/migrations/20261008144600_add_round_outcomes_and_atomic_next.sql`
- Modify: `supabase/tests/poker_permissions.sql`

**Interfaces:**
- Consumes: the existing revealed-round state, host membership checks, round-history query, and Task 1 snapshot.
- Produces:
  - `rounds.note text NULL`, limited to 240 Unicode code points.
  - `update_round_outcome(p_room_id uuid, p_round_id uuid, p_final_estimate text, p_note text) returns jsonb`.
  - `complete_round_and_start_next_round(p_room_id uuid, p_round_id uuid, p_final_estimate text, p_note text) returns jsonb`.
  - Snapshot `round.note` and `recentRounds[].note`.

- [ ] **Step 1: Add failing pgTAP cases for Note update and atomic round transition**

Extend the permissions test to cover:

1. Host updates a revealed round's Note and final estimate and the snapshot returns both.
2. A voter/non-host cannot update the round outcome or start the next round.
3. Empty final estimate cannot complete the round; a NULL/empty Note remains allowed.
4. A 240-character Note succeeds and a 241-character Note fails.
5. One valid next-round call marks the old round archived, preserves the estimate/Note in `recentRounds`, and creates exactly one new `voting` round with the incremented number.
6. Repeating the same call does not create a second round or overwrite the archived result.
7. The previous 20-round retention assertion still holds after the new Note fields are added.

Use fixed-length SQL text values for the boundary cases:

```sql
SELECT lives_ok(
  $$ SELECT update_round_outcome(
       (SELECT room_id FROM poker_test_state),
       (SELECT round_id FROM poker_test_state),
       '5',
       repeat('n', 240)
     ); $$,
  'host may save a 240-character note'
);

SELECT throws_like(
  $$ SELECT update_round_outcome(
       (SELECT room_id FROM poker_test_state),
       (SELECT round_id FROM poker_test_state),
       '5',
       repeat('n', 241)
     ); $$,
  '%240%',
  'a note over 240 characters is rejected'
);
```

Set up a distinct revealed round for transition tests so existing host-transfer and history tests remain isolated. Update the pgTAP plan count exactly.

- [ ] **Step 2: Run pgTAP and verify the new RPC tests fail**

Run: `npx --offline --yes supabase@2.117.0 test db --local`

Expected: the new RPC calls fail because the functions and `rounds.note` do not exist yet.

- [ ] **Step 3: Add the Note column and host-only outcome update RPC**

In the new migration, begin a transaction, add `rounds.note text` with a `char_length(note) <= 240` check, and replace `build_room_snapshot` to include current-round and archived-round notes.

Implement `update_round_outcome` as a `SECURITY DEFINER` function with a fixed `search_path`. Require `auth.uid()`, host membership in the specified room, and a round status of `revealed`. Normalize blank Note to SQL NULL; trim and validate non-null Note length with `char_length`. Allow a NULL final estimate while the host is resolving a tie; if non-null, trim it and reject an empty value. Update only that round and return the caller's authoritative snapshot.

- [ ] **Step 4: Add the single-transaction archive-and-next RPC**

Implement `complete_round_and_start_next_round` with the same fixed `search_path` and host checks. Lock the room and round rows before checking state. For a current `revealed` round, require a non-empty final estimate, validate the Note length, write both values, set the round to `archived`, insert exactly one next `voting` round with `round_number + 1`, and return the authoritative snapshot. Let the existing history-retention trigger keep only the newest 20 archived rounds.

If the supplied round was already archived by a prior successful request, return the current room snapshot without changing the archived outcome or inserting another round. Reject a non-current, non-archived round and any invalid transition. Explicitly grant execute to `authenticated`; do not grant these host operations to anonymous unauthenticated callers.

- [ ] **Step 5: Apply the migration and verify all database cases**

Run:

```bash
npx --offline --yes supabase@2.117.0 migration up --local
npx --offline --yes supabase@2.117.0 test db --local
```

Expected: update authorization, Note boundary, atomic transition, duplicate request, hidden-vote, and 20-round retention tests all pass. Do not use `db reset`.

- [ ] **Step 6: Commit the round-outcome migration and tests**

```bash
git add supabase/migrations/20261008144600_add_round_outcomes_and_atomic_next.sql supabase/tests/poker_permissions.sql
git commit -m "feat(db): add atomic poker round completion"
```

## Task 3: Extend the typed client snapshot and RPC contract

**Files:**
- Modify: `src/lib/database.types.ts`
- Modify: `src/lib/roomApi.ts`
- Modify: `src/lib/roomApi.test.ts`
- Modify: `src/lib/roomSync.test.ts`
- Modify: snapshot factories in `src/features/room/RoomPage.test.tsx`

**Interfaces:**
- Consumes: Task 1-2 SQL JSON shape and function signatures.
- Produces:

```ts
type MemberRecord = {
  id: string;
  nickname: string;
  role: 'host' | 'voter' | 'observer';
  joinedAt: string;
  lastSeenAt: string;
  online: boolean;
  hasVoted: boolean;
  vote: VoteValue | null;
};

type RoundRecord = {
  id: string;
  number: number;
  status: 'voting' | 'revealed' | 'archived';
  finalEstimate: string | null;
  note: string | null;
  startedAt: string;
  revealedAt: string | null;
  archivedAt: string | null;
};
```

The API functions are:

```ts
updateRoundOutcome(
  roomId: string,
  roundId: string,
  finalEstimate: string | null,
  note: string | null,
): Promise<RoomSnapshot>

completeRoundAndStartNextRound(
  roomId: string,
  roundId: string,
  finalEstimate: string,
  note: string | null,
): Promise<RoomSnapshot>
```

Keep the existing two-argument `startNextRound(roomId, roundId)` wrapper in place during Task 3 so the current `RoomPage` caller still type-checks. Task 5 switches the UI to `completeRoundAndStartNextRound` and removes the legacy client wrapper and type entries.

- [ ] **Step 1: Update snapshot fixtures and add failing normalization tests**

Extend the `validSnapshot` fixture in `src/lib/roomApi.test.ts` and shared room snapshot factories with `hasVoted`, `vote`, `round.note`, and `recentRounds[].note`. Add tests that `normalizeRoomSnapshot` rejects a missing/non-boolean `hasVoted`, an invalid member card, an overlong Note, and a non-null member card during `voting`; accept a valid revealed member card.

Run: `npm test -- --run src/lib/roomApi.test.ts src/features/room/RoomPage.test.tsx`

Expected: tests fail on the absent schema validation/types before implementation.

- [ ] **Step 2: Add failing client RPC contract tests**

Add tests that:

```ts
await updateRoundOutcome('room-1', 'round-1', '5', 'Investigate retries');
expect(rpc).toHaveBeenCalledWith('update_round_outcome', {
  p_room_id: 'room-1',
  p_round_id: 'round-1',
  p_final_estimate: '5',
  p_note: 'Investigate retries',
});
```

And:

```ts
await completeRoundAndStartNextRound('room-1', 'round-1', '5', 'Investigate retries');
expect(rpc).toHaveBeenCalledWith('complete_round_and_start_next_round', {
  p_room_id: 'room-1',
  p_round_id: 'round-1',
  p_final_estimate: '5',
  p_note: 'Investigate retries',
});
```

Also assert blank notes normalize to `null`, API errors remain visible, and an over-240-character note is rejected before the network call.

- [ ] **Step 3: Implement the snapshot and RPC types**

Update row/snapshot/archived-round types and `Database.public.Functions` signatures to exactly match Tasks 1-2. Extend `normalizeMember`, `normalizeRound`, `normalizeArchivedRound`, and `normalizeRoomSnapshot`; reject member vote values while the current round is `voting`, and preserve valid `hasVoted` booleans independently from hidden `vote` values.

Implement `updateRoundOutcome` and `completeRoundAndStartNextRound` to trim the estimate, normalize optional Note, validate the 240-code-point Note limit, and call the exact RPC argument names above. Use `Array.from(note).length` for the browser-side Unicode-character count so it matches Postgres `char_length`. Keep the existing two-argument `startNextRound` wrapper and corresponding database type entry unchanged until Task 5 replaces the `RoomPage` caller.

- [ ] **Step 4: Make the room-sync test exercise safe vote-status refresh**

In `src/lib/roomSync.test.ts`, assert that the subscription listens to `room_members` changes for the room and that a membership update invokes the snapshot fetch callback. Keep an assertion that the client does not subscribe to the `votes` table.

Run:

```bash
npm test -- --run src/lib/roomApi.test.ts src/lib/roomSync.test.ts src/features/room/RoomPage.test.tsx
npm run build
```

Expected: all type-contract, privacy-validation, and synchronization tests pass and TypeScript compiles.

- [ ] **Step 5: Commit the client contract**

```bash
git add src/lib/database.types.ts src/lib/roomApi.ts src/lib/roomApi.test.ts src/lib/roomSync.test.ts src/features/room/RoomPage.test.tsx
git commit -m "feat: model member votes and round outcomes"
```

## Task 4: Put member cards and accurate statistics inside the table

**Files:**
- Create: `src/features/room/MemberGrid.tsx`
- Create: `src/features/room/MemberGrid.test.tsx`
- Create: `src/features/room/VoteDistribution.tsx`
- Create: `src/features/room/VoteDistribution.test.tsx`
- Modify: `src/features/room/RoundBoard.tsx`
- Modify: `src/features/room/RoomPage.tsx`
- Modify: `src/features/room/RoomPage.test.tsx`
- Delete: `src/features/room/MemberRail.tsx`
- Modify: `src/app/app.css`

**Interfaces:**
- Consumes: Task 3 `RoomSnapshot`, with each member's safe `hasVoted` and reveal-gated `vote`.
- Produces:

```tsx
<MemberGrid members={snapshot.members} roundStatus={snapshot.round.status} />
<VoteDistribution distribution={snapshot.distribution} />
```

`MemberGrid` renders all members and each member card exposes the role, online state, and `hasVoted` state; it never renders a vote value in `voting`. `VoteDistribution` renders only positive counts.

- [ ] **Step 1: Add failing member-grid tests**

Create tests for:

1. Host and voter cards appear in the grid with nickname and role.
2. `hasVoted` changes a card's state/background and visible status text while the member's vote value stays absent during `voting`.
3. An observer has an observer style/status and no vote card.
4. In a `revealed` snapshot, each voter card shows its own `vote`.
5. A generated list of 100 members renders 100 member cards.

Use stable selectors `data-testid="member-card-${member.id}"`, `data-vote-status="voted|pending|observer"`, and text labels `Voted`, `Waiting`, and `Observer`.

Run: `npm test -- --run src/features/room/MemberGrid.test.tsx`

Expected: FAIL because `MemberGrid.tsx` has not been created.

- [ ] **Step 2: Implement the member grid**

Create `MemberGrid` as a semantic list. For each room member, render a compact card with a nickname, role, online indicator, status label, and a non-interactive face-down card back while voting. Use the member's returned `vote` only when the round is `revealed` or `archived`; render the face-up rank on reveal. Apply voted/pending/observer classes and data attributes; do not derive vote status from the current browser's own vote.

- [ ] **Step 3: Run member-grid tests**

Run: `npm test -- --run src/features/room/MemberGrid.test.tsx`

Expected: all role, privacy, 100-card, and revealed-value cases pass.

- [ ] **Step 4: Add failing distribution tests**

Create `VoteDistribution.test.tsx` with a distribution containing `5: 2`, `8: 1`, and all other Fibonacci values at zero. Assert exactly two bars render, each has an accessible label with the exact count, and the count appears below its bar. Add a zero-vote case with no bars.

Run: `npm test -- --run src/features/room/VoteDistribution.test.tsx`

Expected: FAIL because the component has not been created.

- [ ] **Step 5: Implement the distribution component**

Create a component that returns no chart during voting or when `distribution` is null. Filter entries with `count > 0` before rendering. Scale each positive bar to `count / maxCount * 100`, keep a non-zero minimum height only for entries already known to have votes, and render the exact numeric count under the bar.

- [ ] **Step 6: Separate round status from chart placement**

Keep `RoundBoard` responsible for round number/status and the waiting/revealed label. Update `RoomPage` markup order to place the personal Fibonacci deck near the round status, then `MemberGrid`, then `VoteDistribution`; preserve that DOM order on desktop and mobile so the chart always follows the member list. Remove the `MemberRail` render and delete the now-unused component.

- [ ] **Step 7: Add arcade table-grid and chart styles**

In `src/app/app.css`, add classes scoped under `.room-shell[data-theme="arcade"]`: a full-width table, responsive member-card grid, card-back/front treatments, status-specific background colors, and chart labels/counts. Use a two-column grid on narrow mobile widths and natural vertical page scrolling; do not set a fixed-height member list or hide overflow. Preserve existing arcade theme declarations and reduced-motion rules.

- [ ] **Step 8: Run focused UI tests and build**

Run:

```bash
npm test -- --run src/features/room/MemberGrid.test.tsx src/features/room/VoteDistribution.test.tsx src/features/room/RoomPage.test.tsx
npm run build
```

Expected: the former side-rail selector is absent, the distribution follows the member grid, and all component tests and type checks pass.

- [ ] **Step 9: Commit the table and statistics UI**

```bash
git add src/features/room/MemberGrid.tsx src/features/room/MemberGrid.test.tsx src/features/room/VoteDistribution.tsx src/features/room/VoteDistribution.test.tsx src/features/room/RoundBoard.tsx src/features/room/RoomPage.tsx src/features/room/RoomPage.test.tsx src/features/room/MemberRail.tsx src/app/app.css
git commit -m "feat: move poker members onto the table"
```

## Task 5: Add plurality, editable outcome, Note, and round history

**Files:**
- Create: `src/domain/roundOutcome.ts`
- Create: `src/domain/roundOutcome.test.ts`
- Create: `src/features/room/RoundOutcomeForm.tsx`
- Create: `src/features/room/RoundOutcomeForm.test.tsx`
- Create: `src/features/room/RoundHistory.tsx`
- Create: `src/features/room/RoundHistory.test.tsx`
- Create: `supabase/migrations/20261008144700_revoke_legacy_round_rpcs.sql`
- Modify: `src/features/room/HostControls.tsx`
- Modify: `src/features/room/RoomPage.tsx`
- Modify: `src/features/room/RoomPage.test.tsx`
- Modify: `src/lib/database.types.ts`
- Modify: `src/lib/roomApi.ts`
- Modify: `src/lib/roomApi.test.ts`
- Modify: `supabase/tests/poker_permissions.sql`
- Modify: `src/app/app.css`

**Interfaces:**
- Consumes: Task 3 `updateRoundOutcome` and `completeRoundAndStartNextRound` API functions; Task 4 member grid and distribution placement.
- Produces:

```ts
type EstimateSuggestion =
  | { kind: 'unique'; value: VoteValue }
  | { kind: 'tie'; values: VoteValue[] }
  | { kind: 'no-votes' };

function suggestFinalEstimate(distribution: VoteDistribution | null): EstimateSuggestion;
```

`RoundOutcomeForm` accepts the saved estimate/Note, suggestion, pending/error state, `onSave(finalEstimate, note)`, and `onNextRound(finalEstimate, note)`. `RoundHistory` accepts the snapshot's archived rounds newest-first.

- [ ] **Step 1: Add failing plurality tests**

Add domain tests showing that a single positive maximum returns `{ kind: 'unique', value }`, tied maxima return `{ kind: 'tie', values }` in `FIBONACCI_CARDS` order, and null/all-zero distribution returns `{ kind: 'no-votes' }`.

Run: `npm test -- --run src/domain/roundOutcome.test.ts`

Expected: FAIL because the helper is not defined.

- [ ] **Step 2: Implement the pure plurality helper**

Create `suggestFinalEstimate` without mutating its input. Ignore zero counts, return `no-votes` if no value is positive, return `unique` only for one maximum, and return all tied maximum values in deck order.

- [ ] **Step 3: Add failing outcome-form tests**

Test that the form:

1. Pre-fills a unique plurality value but keeps it editable.
2. Shows tied values and disables Next round until the host selects/enters an estimate.
3. Requires a manually entered estimate when no one voted.
4. Limits Note to 240 Unicode code points and reports rather than truncates an over-limit draft.
5. Saves estimate/Note on blur and retains the draft when the save rejects.
6. Calls Next round with the latest edited values and disables duplicate clicks while pending.

Run: `npm test -- --run src/features/room/RoundOutcomeForm.test.tsx`

Expected: FAIL because the form does not exist.

- [ ] **Step 4: Implement `RoundOutcomeForm`**

Initialize a round's estimate from the persisted value when present; otherwise initialize from a unique suggestion, and initialize tied/no-vote cases empty. Reset the draft only when the round ID changes, not when a same-round Realtime snapshot arrives. Count Note characters with `Array.from(note).length`. On blur, call `onSave` with the latest estimate and Note; keep the local draft visible if the RPC fails. Render the tied choices, field labels, validation messages, and a single **Next round** button. Do not render an Archive button.

- [ ] **Step 5: Wire outcome persistence and the atomic next-round action**

In `RoomPage`, add `handleUpdateOutcome` and change `handleNextRound` to accept the current estimate and Note and call `completeRoundAndStartNextRound`. Set/clear pending state and expose server errors without clearing the host draft. In `HostControls`, render `RoundOutcomeForm` only for the host while the round is `revealed`; retain Reveal, transfer-host controls, connection gating, and existing host-only visibility. Hosts and voters both receive the personal deck during voting; observers do not. Remove the obsolete `archiveRound` wrapper, the old two-argument `startNextRound` wrapper, their `Database` function entries, and related unit-test cases now that no UI calls the separate operations.

- [ ] **Step 6: Revoke the legacy two-call RPCs after the client switches**

Create `supabase/migrations/20261008144700_revoke_legacy_round_rpcs.sql` as an additive transaction that revokes execute from `PUBLIC`, `anon`, and `authenticated` on `archive_round(uuid, uuid, text)` and `start_next_round(uuid, uuid)`. Add pgTAP assertions that authenticated callers cannot execute those old RPCs and that authorized members can execute the new host RPCs. Apply the migration and run `npx --offline --yes supabase@2.117.0 test db --local`. Keep the existing two-call functions available until this step so the older UI remains functional during the staged rollout.

- [ ] **Step 7: Add archived round history tests and component**

Test that `RoundHistory` shows archived rounds newest-first with final estimate and Note, shows no unsaved Note as text, and renders an empty state when no archived rounds exist. Create the component and place it after the revealed distribution so the saved previous-round result remains visible when Next round returns the new current round snapshot.

- [ ] **Step 8: Verify new-round and draft behavior in `RoomPage` tests**

Update `RoomPage.test.tsx` action mocks. Assert the host is allowed to vote, an observer cannot vote, a failed vote leaves the member unsubmitted and displays an actionable error, the Archive button is absent, Next round receives the latest final estimate and Note, successful Next round replaces the current round with the returned snapshot, and a failed outcome save/transition keeps the revealed round and draft visible.

- [ ] **Step 9: Run focused domain/UI tests and build**

Run:

```bash
npm test -- --run src/domain/roundOutcome.test.ts src/features/room/RoundOutcomeForm.test.tsx src/features/room/RoundHistory.test.tsx src/features/room/RoomPage.test.tsx
npm run build
```

Expected: plurality, tie, Note boundary, host voting, editable outcome, and history tests pass with no TypeScript errors.

- [ ] **Step 10: Commit the round-flow UI**

```bash
git add supabase/migrations/20261008144700_revoke_legacy_round_rpcs.sql supabase/tests/poker_permissions.sql src/domain/roundOutcome.ts src/domain/roundOutcome.test.ts src/features/room/RoundOutcomeForm.tsx src/features/room/RoundOutcomeForm.test.tsx src/features/room/RoundHistory.tsx src/features/room/RoundHistory.test.tsx src/features/room/HostControls.tsx src/features/room/RoomPage.tsx src/features/room/RoomPage.test.tsx src/app/app.css
git commit -m "feat: add poker round outcomes and next-round flow"
```

## Task 6: Verify independent joins, privacy, two rounds, capacity, and docs

**Files:**
- Modify: `e2e/room.spec.ts`
- Modify: `e2e/accessibility.spec.ts`
- Modify: `docs/testing.md`

**Interfaces:**
- Consumes: the completed database RPCs, typed snapshots, member grid, chart, outcome form, and history.
- Produces: an E2E regression path for independent joins and multiple rounds; documented local verification commands.

- [ ] **Step 1: Replace the two-context round test with a three-context flow**

Create host, voter-one, and voter-two browser contexts. Create the room with the host, join both voters independently, and wait for all three `member-count` locators to reach 3. Have host and voters submit distinct values; wait for every page to show each voter as Voted while asserting that no other member's rank is visible before Reveal.

- [ ] **Step 2: Run the new E2E scenario to verify it fails**

Run: `npm run test:e2e -- --grep "three independent members"`

Expected: fail on missing member cards/status or the current one-round Archive flow, not on room-capacity setup. Use the local `.env.test` variables described in `docs/testing.md`; do not print keys.

- [ ] **Step 3: Complete the Reveal/chart/outcome/next-round scenario**

Extend the test to have the host Reveal. Assert each submitted member card flips to the exact value, the distribution below the member grid shows only positive values and exact counts, and a unique plurality seeds the editable estimate. Edit the estimate and Note; wait for the voter pages to show the saved values. Click **Next round** once and assert all three clients converge on the incremented `voting` round, the old estimate/Note appear in history, and a member can submit a fresh vote.

- [ ] **Step 4: Add explicit tie handling coverage**

Use an isolated round in a separate E2E test or the form's integration fixture with two values tied at the maximum. Assert the host sees the tied values, no estimate is auto-selected, and Next round remains disabled until a host estimate is entered.

- [ ] **Step 5: Retain capacity and reduced-motion checks**

Keep the existing 100-member fixture and 101st-join rejection test unchanged in meaning. Update the reduced-motion assertion to exercise member-card reveal, chart labels, and final estimate while confirming the same result is visible without animation. Add a mobile-width assertion that the document has no horizontal overflow, and verify the host can reach Reveal and Next round by keyboard with a visible focus indicator. Do not weaken the 100/101 assertions to make the UI test pass.

- [ ] **Step 6: Document local verification**

Update `docs/testing.md` to state that room verification covers three independent browser sessions, safe submitted state, Reveal cards, distribution, Note, and atomic Next round; keep the exact local commands:

```bash
npm test -- --run
npm run build
npm run test:e2e
npm run probe:room
npx --offline --yes supabase@2.117.0 test db --local
```

State that E2E/load checks require a running local Supabase instance and `.env.test`, that the probe must still admit 100 and reject 101, and that the probe is not a hosted production SLA claim.

- [ ] **Step 7: Apply pending local migrations and run all verification**

Run:

```bash
npx --offline --yes supabase@2.117.0 migration up --local
npx --offline --yes supabase@2.117.0 test db --local
npm test -- --run
npm run build
npm run test:e2e
npm run probe:room
git diff --check
```

Expected: every command exits successfully; E2E verifies all three independent clients; the load probe still admits 100, rejects 101, and reports zero failed operations. Do not run `supabase db reset`.

- [ ] **Step 8: Review the final diff and commit only intended files**

Review `git status --short --branch` and `git diff --stat`. Preserve and account for the already-present arcade-style worktree changes; do not stage secrets, `.env.local`, `.env.test`, `dist`, or `.superpowers/`. Stage only the intended source, migrations, tests, and documentation for this approved design.

```bash
git add \
  supabase/migrations/20261008144500_add_member_vote_status.sql \
  supabase/migrations/20261008144600_add_round_outcomes_and_atomic_next.sql \
  supabase/migrations/20261008144700_revoke_legacy_round_rpcs.sql \
  supabase/tests/poker_permissions.sql \
  supabase/tests/poker_realtime.sql \
  src/lib/database.types.ts src/lib/roomApi.ts src/lib/roomApi.test.ts src/lib/roomSync.test.ts \
  src/domain/roundOutcome.ts src/domain/roundOutcome.test.ts \
  src/features/room/MemberGrid.tsx src/features/room/MemberGrid.test.tsx \
  src/features/room/VoteDistribution.tsx src/features/room/VoteDistribution.test.tsx \
  src/features/room/RoundBoard.tsx src/features/room/RoundHistory.tsx src/features/room/RoundHistory.test.tsx \
  src/features/room/RoundOutcomeForm.tsx src/features/room/RoundOutcomeForm.test.tsx \
  src/features/room/HostControls.tsx src/features/room/RoomPage.tsx src/features/room/RoomPage.test.tsx \
  src/features/room/MemberRail.tsx src/app/app.css \
  e2e/room.spec.ts e2e/accessibility.spec.ts docs/testing.md
git diff --cached --check
git commit -m "feat: complete poker table and round flow"
```
