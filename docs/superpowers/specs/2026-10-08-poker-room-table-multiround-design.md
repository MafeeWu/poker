# Poker Room Table and Multi-Round Design

**Status:** Approved in conversation; awaiting written-spec review
**Date:** 2026-10-08
**Scope:** Repair the reported room participation and round-flow experience; move member presence and revealed vote cards into the arcade-style table; make round results and notes visible and persistent.

## 1. Intent and confirmed requirements

The room should feel like a multiplayer card table, not a voting chart with a detached member sidebar. Participants need immediate, privacy-safe feedback that their vote was received; after Reveal, the table should show each participant's actual card and an accurate distribution. Hosts need a one-action transition into the next round without a separate Archive action.

Confirmed decisions:

- Use layout **B**: a wide rectangular felt table containing the members in a responsive grid. Remove the right-side member list.
- Include the host among eligible voters. The host has both host controls and a vote card; observers do not vote.
- During voting, member-card background color identifies whether that member has voted. Also provide a text/icon status so color is not the only signal.
- Keep all vote values secret until Reveal. After Reveal, flip each voting member's card to show their value.
- Put the revealed distribution below the member grid. Omit values with zero votes. Bar height represents vote count, with the number of members displayed below each bar.
- Remove the separate Archive action. Replace it with **Next round**.
- Pre-fill the editable final estimate with the uniquely most-voted card. In a tie, do not choose automatically: require the host to choose/edit an estimate before starting the next round.
- Add an optional Note of at most 240 characters to each round. Room members can see the saved result after Reveal, and the Note remains with that round in the most recent 20 archived rounds.
- Use a server-authoritative safe Realtime vote-status signal and a single atomic archive-and-start-next operation.
- Preserve the existing Fibonacci deck, 100-online-member room limit, room roles, hidden-vote rules, accessibility, and reduced-motion support.

## 2. Current-state findings

- The database schema sets `rooms.max_members` to 100, and `join_room` rejects only when the active member count reaches that configured maximum.
- The existing SQL vote path accepts both `host` and `voter`, and its submitted count includes both roles. The current UI, however, renders a deck only for role `voter`. This mismatch can make the host's participation and the displayed count inconsistent.
- `submit_vote` writes to `votes`; the `votes` table is intentionally absent from the Realtime publication. The current snapshot computes a total submitted count, but does not return a per-member submitted state or individual revealed value. Therefore other clients have no safe, immediate member-card status to render after a vote.
- The current UI displays a member rail beside the table. The distribution chart renders zero-vote values with a minimum bar height.
- The database already supports `voting -> revealed -> archived -> next voting`, keeps up to 20 archived rounds, and stores a host-entered final estimate. The UI requires a separate Archive action before Next round.
- Local investigation with three independent browser contexts successfully joined three members to the same room; all three clients eventually showed a count of three. No two-member database cap was reproduced. A prior local 100-member probe also passed. The reported two-member symptom remains unexplained and must be retained as a regression/investigation item rather than marked as resolved.

## 3. Room table and member cards

The room page will use a full-width table surface. The table contains:

1. A compact current-round/status summary.
2. A responsive grid of all room members, including the host. A room may render up to 100 member cards; the page scrolls vertically rather than hiding members in a side rail.
3. After Reveal, a vote-distribution chart below the entire member grid.

Each member card shows the nickname and role. During `voting`, an eligible member's card back remains visible regardless of the vote value. A submitted member receives the voted background state; a member who has not voted receives a distinct pending background state. Observers use a subdued observer state and have no vote card. Short text or icon labels supplement all status colors. After Reveal, voter cards animate to their selected Fibonacci value; observers remain clearly marked as observers.

The distribution chart includes only cards with a positive count. Bar heights are scaled relative to the largest count, and each bar has an explicit count label below it. No average or median is added. At mobile widths, member cards wrap into fewer columns and the table remains readable without horizontal page overflow.

## 4. Round outcome and next-round flow

The round lifecycle remains `voting -> revealed -> archived`. Reveal freezes the round's votes and makes per-member card values and the distribution visible.

For a revealed round:

- The host sees an editable final-estimate field and an optional Note field.
- If exactly one card has the highest count, initialize the final estimate with that card value.
- If multiple cards tie for the highest count, leave the estimate unset, show the tied values, and require the host to choose/edit a value. If no votes were submitted, the host must enter an estimate manually.
- Limit Note to 240 characters. Trim surrounding whitespace; keep the content as plain text.
- Save host edits through an authorized round-outcome update operation while the round is revealed, so the current estimate and Note can be refreshed for all room members. The Next round operation also submits the latest host-edited values, avoiding a lost final edit if the host clicks immediately after typing.

The host sees **Next round**, not a separate Archive button. A single server transaction must:

1. Verify membership, host role, current round identity/status, estimate validity, and Note length.
2. Persist the final estimate and Note and archive the revealed round.
3. Enforce the existing 20-round archived-history limit.
4. Create the next `voting` round with the next number.
5. Return the authoritative snapshot, including the new current round and recent history.

Failure rolls back the entire transaction; the room must not be left with an archived round but no new round. Repeated/stale requests must not create duplicate rounds or overwrite a completed round's result. After transition, every member sees the new round and can vote again; the archived result and Note remain available in recent history.

## 5. Snapshot, persistence, and Realtime privacy

Add an additive database migration; do not rewrite already-applied migrations.

The room snapshot's member entries will expose:

- `hasVoted: boolean` for the current round, safe to display before Reveal.
- `vote: VoteValue | null`, where `vote` is always `null` to other members while the round is `voting`, and is populated for an eligible member only after the round is `revealed` or `archived`.

The implementation must not add `votes` to the Realtime publication or expose a vote value through an event before Reveal. A safe per-member current-round vote marker (for example, a nullable `last_voted_round_id` on the member row) will be updated by the server when a vote is accepted. Because `room_members` is already published, that update can trigger current-room subscribers to fetch the authoritative snapshot and display the changed `hasVoted` state. A subsequent round naturally compares the marker with a different current-round ID.

The migration will add persisted round Note data. An authorized update operation will let only the room host modify the final estimate and Note while the round is `revealed`; these round-row changes drive Realtime refreshes. The atomic next-round operation will validate and persist the final submitted values again as part of its transaction.

The database, generated TypeScript types, `RoomSnapshot` validator, client RPC wrappers, and recent-round record types must agree on the new fields. RLS/RPC checks remain the authority: only room members read room state, only the host updates round outcome or starts a next round, and no member reads individual values before Reveal.

## 6. Reported two-member limit

The local database configuration and a three-independent-context browser check do not reproduce a hard two-member limit. The implementation must add regression coverage for:

- A host plus at least two separately authenticated participants joining one room.
- All already-connected clients converging on the same member count after each join.
- A submitted vote changing only its member's safe status marker before Reveal.
- Capacity still allowing exactly 100 active members and explicitly rejecting member 101.

If the report remains reproducible outside the local setup, record the join error and client/member counts at each step before changing the maximum. Do not raise the configured limit beyond 100 to mask a synchronization or environment issue.

## 7. Error handling and accessibility

- A failed vote leaves that member visibly unsubmitted and reports an actionable error.
- A failed round-outcome update keeps the host's draft visible and reports the persistence error; it must not claim other members have received the unsaved value.
- A failed Next round transaction leaves the revealed round intact and allows a safe retry.
- Tied or missing estimates prevent Next round and explain what the host must choose.
- Note validation reports the 240-character limit without silently truncating text.
- Status is conveyed through text/icon as well as background color.
- All participant cards and host actions remain keyboard-accessible with visible focus.
- `prefers-reduced-motion` disables card flip and decorative movement while preserving final vote values, member status, and chart information.

## 8. Verification and acceptance criteria

### Unit and component tests

- Host and voter both receive vote controls; observer does not.
- A member's `hasVoted` state renders independently of their hidden vote.
- Vote values are rejected from pre-Reveal snapshots and accepted only for revealed/archived snapshots.
- Unique plurality initializes the final estimate; ties and zero votes require a host choice.
- Only positive distribution counts create bars; each bar exposes the exact member count.
- Note accepts at most 240 characters and is rendered as plain text.
- The 13 Fibonacci cards preserve accessible labels and selected states.

### Database tests

- Vote status updates do not publish a vote value.
- A member can see other members' `hasVoted` markers while voting, but cannot see their card values until Reveal.
- Reveal returns each voter's actual card and correct distribution to room members.
- Only the host can update a revealed round outcome or perform the atomic next-round operation.
- The atomic operation stores estimate and Note, archives exactly the current round, creates exactly one next round, and retains at most 20 archived rounds.
- Invalid status, tie/unset estimate, overlong Note, non-host request, and duplicate/stale next-round request cannot leave partial state.

### Browser and capacity tests

- Three independent contexts join the same room and all receive the same member count.
- Voting updates the voted member's visual background on every connected client without exposing values.
- Reveal flips each voter's card and displays the correct non-zero chart counts below the member grid.
- The host can edit the plurality suggestion and Note, start the next round with one action, and vote again in that round.
- Recent history displays the previous round's estimate and Note.
- Responsive checks cover desktop and mobile, and reduced-motion mode preserves all information.
- A local capacity run still admits 100 online members, rejects the 101st, validates hidden-vote privacy, and measures Reveal propagation.

## 9. Out of scope

- Increasing the 100-member cap.
- Changing room identity, anonymous authentication, card deck, or project-list behavior.
- Adding average/median statistics.
- Publishing individual votes before Reveal.
- Adding a separate room chat or general-purpose notes system.
- Changing deployment provider or making a production capacity/SLA claim.
