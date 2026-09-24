BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(14);

CREATE TEMP TABLE poker_test_state (
  room_id uuid,
  room_code text,
  round_id uuid,
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

RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
SELECT is(
  (SELECT count(*)::bigint FROM public.votes WHERE round_id = (SELECT round_id FROM poker_test_state) AND member_id = (SELECT user_a_member_id FROM poker_test_state)),
  0::bigint,
  'user B cannot read user A hidden vote while voting'
);

SELECT is(
  (SELECT build_room_snapshot((SELECT room_id FROM poker_test_state), '11111111-1111-4111-8111-111111111111'::uuid)->>'myVote'),
  NULL,
  'snapshot does not expose user A hidden vote to user B before reveal'
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
  (SELECT build_room_snapshot((SELECT room_id FROM poker_test_state), '11111111-1111-4111-8111-111111111111'::uuid)->'distribution'->>'3'),
  '1',
  'revealed snapshot exposes user A vote in distribution'
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
CREATE TEMP TABLE archive_case AS
SELECT room_id, round_id
FROM poker_test_state;

INSERT INTO public.rounds (room_id, round_number, status, started_at, revealed_at, archived_at)
SELECT room_id, generate_series(2, 22), 'archived', now(), now(), now()
FROM archive_case;

SELECT is(
  (SELECT count(*)::bigint FROM public.rounds WHERE room_id = (SELECT room_id FROM archive_case) AND status = 'archived'),
  20::bigint,
  'archived rounds are trimmed to newest 20'
);

SELECT * FROM finish();

ROLLBACK;
