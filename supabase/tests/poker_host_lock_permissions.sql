BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(16);

CREATE TEMP TABLE host_lock_state (room jsonb, joined jsonb, observer jsonb, foreign_room jsonb);
GRANT ALL ON host_lock_state TO authenticated;

SET ROLE anon;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT throws_like(
  $$ SELECT public.transfer_host('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'); $$,
  '%Authentication required%', 'unauthenticated requests cannot transfer the host'
);
RESET ROLE;
SELECT ok(has_function_privilege('authenticated', 'public.transfer_host(uuid,uuid)', 'EXECUTE'), 'authenticated can invoke guarded transfer');

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '41111111-1111-4111-8111-111111111111', true);
INSERT INTO host_lock_state (room) SELECT public.create_room('Host lock permissions', 'Host');
SELECT public.reveal_round(
  (SELECT (room->'room'->>'id')::uuid FROM host_lock_state),
  (SELECT (room->'round'->>'id')::uuid FROM host_lock_state)
);
SELECT set_config('request.jwt.claim.sub', '42222222-2222-4222-8222-222222222222', true);
UPDATE host_lock_state SET joined = public.join_room(room->'room'->>'code', 'Voter', 'voter');
SELECT throws_like(
  $$ SELECT public.transfer_host((SELECT (room->'room'->>'id')::uuid FROM host_lock_state), (SELECT (room->>'myMemberId')::uuid FROM host_lock_state)); $$,
  '%Host membership required%', 'a voter cannot transfer the host'
);

SELECT set_config('request.jwt.claim.sub', '43333333-3333-4333-8333-333333333333', true);
UPDATE host_lock_state SET observer = public.join_room(room->'room'->>'code', 'Observer', 'observer');
SELECT set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', true);
UPDATE host_lock_state SET foreign_room = public.create_room('Foreign lock room', 'Foreign Host');
SELECT throws_like(
  $$ SELECT public.transfer_host((SELECT (room->'room'->>'id')::uuid FROM host_lock_state), (SELECT (joined->>'myMemberId')::uuid FROM host_lock_state)); $$,
  '%Host membership required%', 'a nonmember cannot transfer the host'
);

SELECT set_config('request.jwt.claim.sub', '41111111-1111-4111-8111-111111111111', true);
SELECT throws_like(
  $$ SELECT public.transfer_host((SELECT (room->'room'->>'id')::uuid FROM host_lock_state), (SELECT (observer->>'myMemberId')::uuid FROM host_lock_state)); $$,
  '%Target member%', 'an observer cannot become host via transfer'
);
SELECT throws_like(
  $$ SELECT public.transfer_host((SELECT (room->'room'->>'id')::uuid FROM host_lock_state), (SELECT (foreign_room->>'myMemberId')::uuid FROM host_lock_state)); $$,
  '%Target member%', 'a foreign-room member cannot become host'
);
SELECT throws_like(
  $$ SELECT public.transfer_host((SELECT (room->'room'->>'id')::uuid FROM host_lock_state), (SELECT (room->>'myMemberId')::uuid FROM host_lock_state)); $$,
  '%Target member%', 'self-transfer remains invalid'
);

RESET ROLE;
UPDATE public.room_members SET last_seen_at = now() - interval '91 seconds'
WHERE id = (SELECT (joined->>'myMemberId')::uuid FROM host_lock_state);
SET ROLE authenticated;
SELECT throws_like(
  $$ SELECT public.transfer_host((SELECT (room->'room'->>'id')::uuid FROM host_lock_state), (SELECT (joined->>'myMemberId')::uuid FROM host_lock_state)); $$,
  '%Target member%', 'an offline voter cannot become host'
);
RESET ROLE;
UPDATE public.room_members SET last_seen_at = now()
WHERE id = (SELECT (joined->>'myMemberId')::uuid FROM host_lock_state);
SET ROLE authenticated;
SELECT lives_ok(
  $$ SELECT public.transfer_host((SELECT (room->'room'->>'id')::uuid FROM host_lock_state), (SELECT (joined->>'myMemberId')::uuid FROM host_lock_state)); $$,
  'a current voter can become host'
);
SELECT is(
  (SELECT host_member_id FROM public.rooms WHERE id = (SELECT (room->'room'->>'id')::uuid FROM host_lock_state)),
  (SELECT (joined->>'myMemberId')::uuid FROM host_lock_state), 'room points to the new host'
);
SELECT is(
  (SELECT count(*) FROM public.room_members WHERE room_id = (SELECT (room->'room'->>'id')::uuid FROM host_lock_state) AND role = 'host'),
  1::bigint, 'exactly one member has host role'
);
SELECT is(
  (SELECT role FROM public.room_members WHERE id = (SELECT (room->>'myMemberId')::uuid FROM host_lock_state)),
  'voter', 'former host becomes a voter'
);
SELECT is(
  (SELECT role FROM public.room_members WHERE id = (SELECT (joined->>'myMemberId')::uuid FROM host_lock_state)),
  'host', 'target gains host role'
);
SELECT throws_like(
  $$ SELECT public.complete_round_and_start_next_round((SELECT (room->'room'->>'id')::uuid FROM host_lock_state), (SELECT (room->'round'->>'id')::uuid FROM host_lock_state), '8', NULL); $$,
  '%Host membership required%', 'former host cannot start Next after transfer'
);
SELECT set_config('request.jwt.claim.sub', '42222222-2222-4222-8222-222222222222', true);
SELECT lives_ok(
  $$ SELECT public.complete_round_and_start_next_round((SELECT (room->'room'->>'id')::uuid FROM host_lock_state), (SELECT (room->'round'->>'id')::uuid FROM host_lock_state), '8', NULL); $$,
  'new host can atomically start Next'
);
SELECT is(
  (SELECT count(*) FROM public.rounds WHERE room_id = (SELECT (room->'room'->>'id')::uuid FROM host_lock_state) AND status = 'voting'),
  1::bigint, 'transfer followed by Next creates exactly one voting round'
);

SELECT * FROM finish();
ROLLBACK;
