BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE TEMP TABLE revote_state (room jsonb, voter jsonb, observer jsonb, snapshot jsonb);
GRANT ALL ON revote_state TO authenticated;

SELECT ok(NOT has_function_privilege('anon', 'public.submit_vote(uuid,uuid,text)', 'EXECUTE'), 'unauthenticated callers cannot vote');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT throws_like(
  $$ SELECT public.submit_vote('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '8'); $$,
  '%Authentication required%', 'revotes require an authenticated identity'
);

SELECT set_config('request.jwt.claim.sub', '51111111-1111-4111-8111-111111111111', true);
INSERT INTO revote_state (room) SELECT public.create_room('Shown revotes', 'Host');
SELECT public.submit_vote((SELECT (room->'room'->>'id')::uuid FROM revote_state), (SELECT (room->'round'->>'id')::uuid FROM revote_state), '3');
SELECT set_config('request.jwt.claim.sub', '52222222-2222-4222-8222-222222222222', true);
UPDATE revote_state SET voter = public.join_room(room->'room'->>'code', 'Voter', 'voter');
SELECT public.submit_vote((SELECT (room->'room'->>'id')::uuid FROM revote_state), (SELECT (room->'round'->>'id')::uuid FROM revote_state), '5');
SELECT public.reveal_round((SELECT (room->'room'->>'id')::uuid FROM revote_state), (SELECT (room->'round'->>'id')::uuid FROM revote_state));
SELECT public.update_round_outcome((SELECT (room->'room'->>'id')::uuid FROM revote_state), (SELECT (room->'round'->>'id')::uuid FROM revote_state), '13', 'Keep the agreed outcome');

SELECT lives_ok(
  $$ SELECT public.submit_vote((SELECT (room->'room'->>'id')::uuid FROM revote_state), (SELECT (room->'round'->>'id')::uuid FROM revote_state), '8'); $$,
  'a voter can change a shown vote'
);
UPDATE revote_state SET snapshot = public.build_room_snapshot((room->'room'->>'id')::uuid, auth.uid());
SELECT is((SELECT snapshot->>'myVote' FROM revote_state), '8', 'the caller sees their updated vote');
SELECT is((SELECT snapshot->'round'->>'status' FROM revote_state), 'revealed', 'revoting keeps the round shown');
SELECT is((SELECT snapshot->'round'->>'finalEstimate' FROM revote_state), '13', 'revoting preserves the final estimate');
SELECT is((SELECT snapshot->'round'->>'note' FROM revote_state), 'Keep the agreed outcome', 'revoting preserves the Note');
SELECT is((SELECT (snapshot->'distribution'->>'5')::integer FROM revote_state), 0, 'the old vote is removed from the distribution');
SELECT is((SELECT (snapshot->'distribution'->>'8')::integer FROM revote_state), 1, 'the new vote is counted once');
SELECT is((SELECT (snapshot->>'submittedCount')::integer FROM revote_state), 2, 'revoting does not add another submission');
SELECT throws_like(
  $$ SELECT public.submit_vote((SELECT (room->'room'->>'id')::uuid FROM revote_state), (SELECT (room->'round'->>'id')::uuid FROM revote_state), '7'); $$,
  '%Invalid Fibonacci card%', 'shown votes still require a valid card'
);

SELECT set_config('request.jwt.claim.sub', '51111111-1111-4111-8111-111111111111', true);
SELECT lives_ok(
  $$ SELECT public.submit_vote((SELECT (room->'room'->>'id')::uuid FROM revote_state), (SELECT (room->'round'->>'id')::uuid FROM revote_state), '5'); $$,
  'the host can change a shown vote'
);
UPDATE revote_state SET snapshot = public.build_room_snapshot((room->'room'->>'id')::uuid, auth.uid());
SELECT is((SELECT snapshot->>'myVote' FROM revote_state), '5', 'the host sees their updated vote');
SELECT is(
  (SELECT member->>'vote' FROM revote_state, LATERAL jsonb_array_elements(snapshot->'members') AS member WHERE member->>'id' = voter->>'myMemberId'),
  '8', 'the host sees the voter updated card'
);

SELECT set_config('request.jwt.claim.sub', '53333333-3333-4333-8333-333333333333', true);
UPDATE revote_state SET observer = public.join_room(room->'room'->>'code', 'Observer', 'observer');
SELECT throws_like(
  $$ SELECT public.submit_vote((SELECT (room->'room'->>'id')::uuid FROM revote_state), (SELECT (room->'round'->>'id')::uuid FROM revote_state), '21'); $$,
  '%voter%', 'observers cannot vote after Show'
);
UPDATE revote_state SET snapshot = public.build_room_snapshot((room->'room'->>'id')::uuid, auth.uid());
SELECT is(
  (SELECT member->>'vote' FROM revote_state, LATERAL jsonb_array_elements(snapshot->'members') AS member WHERE member->>'id' = voter->>'myMemberId'),
  '8', 'observers can see updated cards'
);

SELECT set_config('request.jwt.claim.sub', '54444444-4444-4444-8444-444444444444', true);
SELECT throws_like(
  $$ SELECT public.submit_vote((SELECT (room->'room'->>'id')::uuid FROM revote_state), (SELECT (room->'round'->>'id')::uuid FROM revote_state), '21'); $$,
  '%Membership required%', 'non-members cannot change shown votes'
);
SELECT public.join_room((SELECT room->'room'->>'code' FROM revote_state), 'Late voter', 'voter');
SELECT lives_ok(
  $$ SELECT public.submit_vote((SELECT (room->'room'->>'id')::uuid FROM revote_state), (SELECT (room->'round'->>'id')::uuid FROM revote_state), '?'); $$,
  'a member can submit their first vote after Show'
);

SELECT set_config('request.jwt.claim.sub', '52222222-2222-4222-8222-222222222222', true);
SELECT public.complete_round_and_start_next_round((SELECT (room->'room'->>'id')::uuid FROM revote_state), (SELECT (room->'round'->>'id')::uuid FROM revote_state), '13', 'Keep the agreed outcome');
SELECT throws_like(
  $$ SELECT public.submit_vote((SELECT (room->'room'->>'id')::uuid FROM revote_state), (SELECT (room->'round'->>'id')::uuid FROM revote_state), '21'); $$,
  '%Round is not accepting votes%', 'the archived round rejects late vote changes'
);
UPDATE revote_state SET snapshot = public.build_room_snapshot((room->'room'->>'id')::uuid, auth.uid());
SELECT is((SELECT (snapshot->'recentRounds'->0->'distribution'->>'8')::integer FROM revote_state), 1, 'history preserves the last shown vote');
SELECT is((SELECT snapshot->>'myVote' FROM revote_state), NULL::text, 'Next starts with no current vote');
SELECT is((SELECT snapshot->'round'->>'status' FROM revote_state), 'voting', 'Next starts a private voting round');

SELECT * FROM finish();
ROLLBACK;
