BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(46);

CREATE TEMP TABLE poker_test_state (
  room_id uuid,
  room_code text,
  round_id uuid,
  transition_round_id uuid,
  transition_response jsonb,
  duplicate_response jsonb,
  user_a_member_id uuid,
  user_b_member_id uuid,
  user_c_member_id uuid
);

GRANT ALL ON TABLE poker_test_state TO authenticated;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
WITH room_meta AS (
  SELECT create_room('Planning Room', 'Alice') AS payload
)
INSERT INTO poker_test_state (room_id, room_code, round_id, user_a_member_id)
SELECT
  (payload->'room'->>'id')::uuid,
  payload->'room'->>'code',
  (payload->'round'->>'id')::uuid,
  (payload->'members'->0->>'id')::uuid
FROM room_meta;

SELECT is(
  (SELECT name FROM public.rooms WHERE id = (SELECT room_id FROM poker_test_state)),
  'Planning Room',
  'create room as user A'
);

RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
UPDATE poker_test_state
SET user_b_member_id = (
  SELECT (m->>'id')::uuid
  FROM jsonb_array_elements((join_room((SELECT room_code FROM poker_test_state), 'Bob', 'observer'))->'members') AS m
  WHERE m->>'nickname' = 'Bob'
);

SELECT is(
  (SELECT count(*)::bigint FROM public.room_members WHERE room_id = (SELECT room_id FROM poker_test_state) AND auth_user_id = '22222222-2222-4222-8222-222222222222'),
  1::bigint,
  'user B joins room as observer'
);

SELECT throws_like(
  $$ SELECT submit_vote((SELECT room_id FROM poker_test_state), (SELECT round_id FROM poker_test_state), '3'); $$,
  '%voter%',
  'observer submit_vote raises'
);

SELECT throws_like(
  $$ SELECT reveal_round((SELECT room_id FROM poker_test_state), (SELECT round_id FROM poker_test_state)); $$,
  '%privileges%',
  'observer cannot reveal'
);

RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
SELECT is(
  (SELECT submit_vote((SELECT room_id FROM poker_test_state), (SELECT round_id FROM poker_test_state), '3')->>'myVote'),
  '3',
  'user A submits a vote'
);

SELECT is(
  (
    SELECT (to_jsonb(rm)->>'last_voted_round_id')::uuid
    FROM public.room_members rm
    WHERE rm.id = (SELECT user_a_member_id FROM poker_test_state)
  ),
  (SELECT round_id FROM poker_test_state),
  'successful vote updates the member Realtime marker'
);

RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
SELECT is(
  (SELECT count(*)::bigint FROM public.votes WHERE round_id = (SELECT round_id FROM poker_test_state) AND member_id = (SELECT user_a_member_id FROM poker_test_state)),
  0::bigint,
  'user B cannot read user A hidden vote while voting'
);

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

SELECT is(
  (SELECT build_room_snapshot((SELECT room_id FROM poker_test_state), '11111111-1111-4111-8111-111111111111'::uuid)->>'myVote'),
  NULL,
  'snapshot does not expose user A hidden vote to user B before reveal'
);

SELECT is(
  (SELECT build_room_snapshot((SELECT room_id FROM poker_test_state), '11111111-1111-4111-8111-111111111111'::uuid)->>'myMemberId'),
  (SELECT user_b_member_id::text FROM poker_test_state),
  'snapshot identifies the caller member before reveal'
);

SELECT is(
  (SELECT (build_room_snapshot((SELECT room_id FROM poker_test_state), '11111111-1111-4111-8111-111111111111'::uuid)->>'submittedCount')::integer),
  1,
  'snapshot counts eligible submissions before reveal'
);

RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
SELECT is(
  (SELECT reveal_round((SELECT room_id FROM poker_test_state), (SELECT round_id FROM poker_test_state))->'round'->>'status'),
  'revealed',
  'user A can reveal'
);

RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
SELECT is(
  (SELECT count(*)::bigint FROM public.votes WHERE round_id = (SELECT round_id FROM poker_test_state) AND member_id = (SELECT user_a_member_id FROM poker_test_state)),
  1::bigint,
  'user B can read revealed votes'
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
  '3',
  'revealed snapshot exposes the host card to members'
);

SELECT is(
  (
    SELECT member->>'hasVoted'
    FROM jsonb_array_elements(
      build_room_snapshot(
        (SELECT room_id FROM poker_test_state),
        '22222222-2222-4222-8222-222222222222'::uuid
      )->'members'
    ) AS member
    WHERE member->>'id' = (SELECT user_b_member_id::text FROM poker_test_state)
  ),
  'false',
  'observer remains unsubmitted after reveal'
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
    WHERE member->>'id' = (SELECT user_b_member_id::text FROM poker_test_state)
  ),
  NULL,
  'observer has no card after reveal'
);

SELECT is(
  (SELECT build_room_snapshot((SELECT room_id FROM poker_test_state), '11111111-1111-4111-8111-111111111111'::uuid)->'distribution'->>'3'),
  '1',
  'revealed snapshot exposes user A vote in distribution'
);

SELECT is(
  (SELECT build_room_snapshot((SELECT room_id FROM poker_test_state), '11111111-1111-4111-8111-111111111111'::uuid)->>'myMemberId'),
  (SELECT user_b_member_id::text FROM poker_test_state),
  'snapshot identifies the caller member after reveal'
);

SELECT is(
  (SELECT (build_room_snapshot((SELECT room_id FROM poker_test_state), '11111111-1111-4111-8111-111111111111'::uuid)->>'submittedCount')::integer),
  1,
  'snapshot counts eligible submissions after reveal'
);

RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
SELECT throws_like(
  $$ SELECT transfer_host((SELECT room_id FROM poker_test_state), (SELECT user_a_member_id FROM poker_test_state)); $$,
  '%membership%',
  'third user cannot mutate room'
);

RESET ROLE;
UPDATE public.room_members
SET role = 'voter'
WHERE id = (SELECT user_b_member_id FROM poker_test_state);
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
SELECT is(
  (SELECT transfer_host((SELECT room_id FROM poker_test_state), (SELECT user_b_member_id FROM poker_test_state))->'room'->>'hostMemberId'),
  (SELECT user_b_member_id::text FROM poker_test_state),
  'host transfer succeeds for a current voter'
);

RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
SELECT is(
  (SELECT reveal_round((SELECT room_id FROM poker_test_state), (SELECT round_id FROM poker_test_state))->'round'->>'status'),
  'revealed',
  'repeated reveal is idempotent'
);

RESET ROLE;
INSERT INTO public.rounds (room_id, round_number, status, started_at, revealed_at)
SELECT room_id, 2, 'revealed', now(), now()
FROM poker_test_state;

UPDATE poker_test_state
SET transition_round_id = (
  SELECT id FROM public.rounds
  WHERE room_id = poker_test_state.room_id AND round_number = 2
);

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
SELECT throws_like(
  $$ SELECT update_round_outcome((SELECT room_id FROM poker_test_state), (SELECT transition_round_id FROM poker_test_state), '5', 'not host'); $$,
  '%Host%',
  'non-host cannot update a round outcome'
);

SELECT throws_like(
  $$ SELECT complete_round_and_start_next_round((SELECT room_id FROM poker_test_state), (SELECT transition_round_id FROM poker_test_state), '5', 'not host'); $$,
  '%Host%',
  'non-host cannot complete a round or start the next'
);

RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
SELECT lives_ok(
  $$ SELECT update_round_outcome((SELECT room_id FROM poker_test_state), (SELECT transition_round_id FROM poker_test_state), NULL, ''); $$,
  'host may leave the estimate unset and save an empty note'
);

SELECT is(
  (SELECT build_room_snapshot((SELECT room_id FROM poker_test_state), '22222222-2222-4222-8222-222222222222'::uuid)->'round'->>'finalEstimate'),
  NULL,
  'an unresolved final estimate remains NULL'
);

SELECT is(
  (SELECT build_room_snapshot((SELECT room_id FROM poker_test_state), '22222222-2222-4222-8222-222222222222'::uuid)->'round'->>'note'),
  NULL,
  'an empty note is normalized to NULL'
);

SELECT throws_like(
  $$ SELECT update_round_outcome((SELECT room_id FROM poker_test_state), (SELECT transition_round_id FROM poker_test_state), '', ''); $$,
  '%estimate%',
  'an empty final estimate cannot be saved'
);

SELECT lives_ok(
  $$ SELECT update_round_outcome(
       (SELECT room_id FROM poker_test_state),
       (SELECT transition_round_id FROM poker_test_state),
       '5',
       repeat('n', 240)
     ); $$,
  'host may save a 240-character note'
);

SELECT is(
  (SELECT build_room_snapshot((SELECT room_id FROM poker_test_state), '22222222-2222-4222-8222-222222222222'::uuid)->'round'->>'note'),
  repeat('n', 240),
  'snapshot returns the current round note'
);

SELECT is(
  (SELECT build_room_snapshot((SELECT room_id FROM poker_test_state), '22222222-2222-4222-8222-222222222222'::uuid)->'round'->>'finalEstimate'),
  '5',
  'snapshot returns the host-edited final estimate'
);

SELECT throws_like(
  $$ SELECT update_round_outcome(
       (SELECT room_id FROM poker_test_state),
       (SELECT transition_round_id FROM poker_test_state),
       '5',
       repeat('n', 241)
     ); $$,
  '%240%',
  'a note over 240 characters is rejected'
);

SELECT throws_like(
  $$ SELECT complete_round_and_start_next_round((SELECT room_id FROM poker_test_state), (SELECT transition_round_id FROM poker_test_state), '', 'atomic note'); $$,
  '%estimate%',
  'an empty final estimate cannot complete the round'
);

SELECT lives_ok(
  $$ UPDATE poker_test_state
     SET transition_response = complete_round_and_start_next_round(room_id, transition_round_id, '8', 'atomic note'); $$,
  'host completes the round and starts the next round atomically'
);

SELECT is(
  (SELECT transition_response->'round'->>'status' FROM poker_test_state),
  'voting',
  'atomic completion starts a voting round'
);

SELECT is(
  (SELECT (transition_response->'round'->>'number')::integer FROM poker_test_state),
  3,
  'atomic completion increments the round number'
);

SELECT is(
  (SELECT status FROM public.rounds WHERE id = (SELECT transition_round_id FROM poker_test_state)),
  'archived',
  'atomic completion archives the previous round'
);

SELECT is(
  (
    SELECT archived_round->>'finalEstimate'
    FROM jsonb_array_elements(build_room_snapshot((SELECT room_id FROM poker_test_state), '22222222-2222-4222-8222-222222222222'::uuid)->'recentRounds') AS archived_round
    WHERE archived_round->>'id' = (SELECT transition_round_id::text FROM poker_test_state)
  ),
  '8',
  'recent round history preserves the final estimate'
);

SELECT is(
  (
    SELECT archived_round->>'note'
    FROM jsonb_array_elements(build_room_snapshot((SELECT room_id FROM poker_test_state), '22222222-2222-4222-8222-222222222222'::uuid)->'recentRounds') AS archived_round
    WHERE archived_round->>'id' = (SELECT transition_round_id::text FROM poker_test_state)
  ),
  'atomic note',
  'recent round history preserves the note'
);

SELECT lives_ok(
  $$ UPDATE poker_test_state
     SET duplicate_response = complete_round_and_start_next_round(room_id, transition_round_id, '13', 'replacement note'); $$,
  'repeating completion succeeds idempotently'
);

SELECT is(
  (SELECT (duplicate_response->'round'->>'number')::integer FROM poker_test_state),
  3,
  'repeating completion returns the existing current round'
);

SELECT is(
  (
    SELECT archived_round->>'finalEstimate'
    FROM jsonb_array_elements(build_room_snapshot((SELECT room_id FROM poker_test_state), '22222222-2222-4222-8222-222222222222'::uuid)->'recentRounds') AS archived_round
    WHERE archived_round->>'id' = (SELECT transition_round_id::text FROM poker_test_state)
  ),
  '8',
  'repeating completion does not overwrite the archived estimate'
);

SELECT is(
  (
    SELECT archived_round->>'note'
    FROM jsonb_array_elements(build_room_snapshot((SELECT room_id FROM poker_test_state), '22222222-2222-4222-8222-222222222222'::uuid)->'recentRounds') AS archived_round
    WHERE archived_round->>'id' = (SELECT transition_round_id::text FROM poker_test_state)
  ),
  'atomic note',
  'repeating completion does not overwrite the archived note'
);

SELECT is(
  (SELECT count(*)::bigint FROM public.rounds WHERE room_id = (SELECT room_id FROM poker_test_state) AND status = 'voting'),
  1::bigint,
  'repeating completion does not create another voting round'
);

RESET ROLE;
CREATE TEMP TABLE archive_case AS
SELECT room_id, round_id
FROM poker_test_state;

INSERT INTO public.rounds (room_id, round_number, status, started_at, revealed_at, archived_at)
SELECT room_id, generate_series(4, 24), 'archived', now(), now(), now()
FROM archive_case;

SELECT is(
  (SELECT count(*)::bigint FROM public.rounds WHERE room_id = (SELECT room_id FROM archive_case) AND status = 'archived'),
  20::bigint,
  'archived rounds are trimmed to newest 20'
);

SELECT * FROM finish();

ROLLBACK;
