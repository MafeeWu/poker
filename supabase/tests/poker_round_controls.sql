BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE TEMP TABLE round_control_state (room jsonb, voter jsonb, observer jsonb, foreign_room jsonb);
GRANT ALL ON round_control_state TO authenticated;

SELECT is(to_regprocedure('public.transfer_host(uuid,uuid)')::text, NULL::text, 'manual host transfer is unavailable');
SELECT ok(NOT has_function_privilege('anon', 'public.reveal_round(uuid,uuid)', 'EXECUTE'), 'unauthenticated callers cannot invoke reveal');
SELECT ok(NOT has_function_privilege('anon', 'public.update_round_outcome(uuid,uuid,text,text)', 'EXECUTE'), 'unauthenticated callers cannot invoke outcome editing');
SELECT ok(NOT has_function_privilege('anon', 'public.complete_round_and_start_next_round(uuid,uuid,text,text)', 'EXECUTE'), 'unauthenticated callers cannot invoke Next');

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT throws_like(
  $$ SELECT public.reveal_round('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'); $$,
  '%Authentication required%', 'reveal requires an authenticated identity'
);

SELECT set_config('request.jwt.claim.sub', '41111111-1111-4111-8111-111111111111', true);
INSERT INTO round_control_state (room) SELECT public.create_room('Shared round controls', 'Host');
SELECT set_config('request.jwt.claim.sub', '42222222-2222-4222-8222-222222222222', true);
UPDATE round_control_state SET voter = public.join_room(room->'room'->>'code', 'Voter', 'voter');
SELECT set_config('request.jwt.claim.sub', '43333333-3333-4333-8333-333333333333', true);
UPDATE round_control_state SET observer = public.join_room(room->'room'->>'code', 'Observer', 'observer');
SELECT throws_like(
  $$ SELECT public.reveal_round((SELECT (room->'room'->>'id')::uuid FROM round_control_state), (SELECT (room->'round'->>'id')::uuid FROM round_control_state)); $$,
  '%privileges%', 'an observer cannot reveal'
);
SELECT throws_like(
  $$ SELECT public.submit_vote((SELECT (room->'room'->>'id')::uuid FROM round_control_state), (SELECT (room->'round'->>'id')::uuid FROM round_control_state), '8'); $$,
  '%voter%', 'an observer still cannot vote'
);

SELECT set_config('request.jwt.claim.sub', '42222222-2222-4222-8222-222222222222', true);
SELECT lives_ok(
  $$ SELECT public.reveal_round((SELECT (room->'room'->>'id')::uuid FROM round_control_state), (SELECT (room->'round'->>'id')::uuid FROM round_control_state)); $$,
  'a voter can reveal without becoming host'
);
SELECT set_config('request.jwt.claim.sub', '41111111-1111-4111-8111-111111111111', true);
SELECT public.reveal_round(
  (SELECT (room->'room'->>'id')::uuid FROM round_control_state),
  (SELECT (room->'round'->>'id')::uuid FROM round_control_state)
);
SELECT set_config('request.jwt.claim.sub', '42222222-2222-4222-8222-222222222222', true);
SELECT lives_ok(
  $$ SELECT public.update_round_outcome((SELECT (room->'room'->>'id')::uuid FROM round_control_state), (SELECT (room->'round'->>'id')::uuid FROM round_control_state), '8', 'Voter result'); $$,
  'a voter can edit a revealed outcome'
);

SELECT set_config('request.jwt.claim.sub', '43333333-3333-4333-8333-333333333333', true);
SELECT throws_like(
  $$ SELECT public.update_round_outcome((SELECT (room->'room'->>'id')::uuid FROM round_control_state), (SELECT (room->'round'->>'id')::uuid FROM round_control_state), '13', 'Observer edit'); $$,
  '%privileges%', 'an observer cannot edit an outcome'
);
SELECT throws_like(
  $$ SELECT public.complete_round_and_start_next_round((SELECT (room->'room'->>'id')::uuid FROM round_control_state), (SELECT (room->'round'->>'id')::uuid FROM round_control_state), '13', NULL); $$,
  '%privileges%', 'an observer cannot advance a round'
);
SELECT is(
  (SELECT public.build_room_snapshot((room->'room'->>'id')::uuid, '43333333-3333-4333-8333-333333333333'::uuid)->'round'->>'note' FROM round_control_state),
  'Voter result', 'an observer can read the shared outcome without changing it'
);

SELECT set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', true);
UPDATE round_control_state SET foreign_room = public.create_room('Other room', 'Other Host');
SELECT throws_like(
  $$ SELECT public.reveal_round((SELECT (room->'room'->>'id')::uuid FROM round_control_state), (SELECT (room->'round'->>'id')::uuid FROM round_control_state)); $$,
  '%Membership required%', 'a host of another room cannot reveal'
);
SELECT throws_like(
  $$ SELECT public.update_round_outcome((SELECT (room->'room'->>'id')::uuid FROM round_control_state), (SELECT (room->'round'->>'id')::uuid FROM round_control_state), '13', NULL); $$,
  '%Membership required%', 'a host of another room cannot edit the outcome'
);
SELECT throws_like(
  $$ SELECT public.complete_round_and_start_next_round((SELECT (room->'room'->>'id')::uuid FROM round_control_state), (SELECT (room->'round'->>'id')::uuid FROM round_control_state), '13', NULL); $$,
  '%Membership required%', 'a host of another room cannot advance the round'
);

SELECT set_config('request.jwt.claim.sub', '42222222-2222-4222-8222-222222222222', true);
SELECT lives_ok(
  $$ SELECT public.complete_round_and_start_next_round((SELECT (room->'room'->>'id')::uuid FROM round_control_state), (SELECT (room->'round'->>'id')::uuid FROM round_control_state), '8', 'Voter result'); $$,
  'a voter can archive the outcome and start Next atomically'
);
SELECT set_config('request.jwt.claim.sub', '41111111-1111-4111-8111-111111111111', true);
SELECT lives_ok(
  $$ SELECT public.complete_round_and_start_next_round((SELECT (room->'room'->>'id')::uuid FROM round_control_state), (SELECT (room->'round'->>'id')::uuid FROM round_control_state), '13', 'Late retry'); $$,
  'another eligible member can retry completion safely'
);
SELECT is(
  (SELECT count(*) FROM public.rounds WHERE room_id = (SELECT (room->'room'->>'id')::uuid FROM round_control_state) AND status = 'voting'),
  1::bigint, 'member retries leave exactly one voting round'
);
SELECT is(
  (SELECT note FROM public.rounds WHERE id = (SELECT (room->'round'->>'id')::uuid FROM round_control_state)),
  'Voter result', 'member retries do not replace the archived outcome'
);
SELECT is(
  (SELECT host_member_id FROM public.rooms WHERE id = (SELECT (room->'room'->>'id')::uuid FROM round_control_state)),
  (SELECT (room->'room'->>'hostMemberId')::uuid FROM round_control_state), 'round controls do not transfer host identity'
);

SELECT * FROM finish();
ROLLBACK;
