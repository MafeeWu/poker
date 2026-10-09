BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(15);

CREATE TEMP TABLE nickname_test_state (room_id uuid, room_code text);
GRANT ALL ON TABLE nickname_test_state TO authenticated;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
WITH created AS (
  SELECT public.create_room('Unique nickname fixture', 'Mina') AS payload
)
INSERT INTO nickname_test_state
SELECT (payload->'room'->>'id')::uuid, payload->'room'->>'code' FROM created;

SELECT set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
SELECT throws_like(
  $$SELECT public.join_room((SELECT room_code FROM nickname_test_state), ' mina ', 'voter');$$,
  '%Nickname is already in use%',
  'a voter cannot use the host nickname with different case or surrounding spaces'
);
SELECT is(
  (SELECT count(*) FROM public.room_members WHERE room_id = (SELECT room_id FROM nickname_test_state)),
  0::bigint,
  'a rejected join does not create a membership or grant room access'
);
SELECT throws_like(
  $$SELECT public.join_room((SELECT room_code FROM nickname_test_state), 'MINA', 'observer');$$,
  '%Nickname is already in use%',
  'observers cannot duplicate a host nickname'
);

SELECT public.join_room((SELECT room_code FROM nickname_test_state), 'Bob', 'voter');
SELECT lives_ok(
  $$SELECT public.join_room((SELECT room_code FROM nickname_test_state), ' BOB ', 'voter');$$,
  'the same identity can reuse its own nickname'
);
SELECT is(
  (SELECT nickname FROM public.room_members
    WHERE room_id = (SELECT room_id FROM nickname_test_state)
      AND auth_user_id = auth.uid()),
  'BOB',
  'a successful join trims surrounding spaces without changing display case'
);
SELECT throws_like(
  $$SELECT public.join_room((SELECT room_code FROM nickname_test_state), 'Mina', 'observer');$$,
  '%Nickname is already in use%',
  'an existing member cannot rename itself to another member nickname'
);
SELECT is(
  (SELECT nickname || ':' || role FROM public.room_members
    WHERE room_id = (SELECT room_id FROM nickname_test_state)
      AND auth_user_id = auth.uid()),
  'BOB:voter',
  'a rejected rename preserves the original nickname and role'
);

RESET ROLE;
UPDATE public.room_members
SET last_seen_at = now() - interval '2 minutes'
WHERE room_id = (SELECT room_id FROM nickname_test_state) AND nickname = 'Mina';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
SELECT throws_like(
  $$SELECT public.join_room((SELECT room_code FROM nickname_test_state), 'Mina', 'voter');$$,
  '%Nickname is already in use%',
  'an offline member still reserves its nickname'
);
SELECT throws_like(
  $$SELECT public.join_room((SELECT room_code FROM nickname_test_state), 'bob', 'observer');$$,
  '%Nickname is already in use%',
  'observers cannot duplicate a voter nickname'
);
SELECT lives_ok(
  $$SELECT public.create_room('Another nickname fixture', 'Mina');$$,
  'the same nickname is allowed in another room'
);
SELECT lives_ok(
  $$SELECT public.join_room((SELECT room_code FROM nickname_test_state), 'Carol', 'observer');$$,
  'a distinct observer nickname is admitted'
);

RESET ROLE;
SELECT throws_ok(
  $$INSERT INTO public.room_members (room_id, auth_user_id, nickname, role)
    VALUES ((SELECT room_id FROM nickname_test_state),
      '44444444-4444-4444-8444-444444444444', ' mina ', 'voter');$$,
  '23505', NULL,
  'the database constraint also rejects duplicate direct inserts'
);
SELECT throws_ok(
  $$UPDATE public.room_members SET nickname = 'bob'
    WHERE room_id = (SELECT room_id FROM nickname_test_state) AND nickname = 'Carol';$$,
  '23505', NULL,
  'the database constraint also rejects duplicate direct updates'
);

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
SELECT public.leave_room(
  (SELECT room_id FROM nickname_test_state),
  (SELECT id FROM public.room_members
    WHERE room_id = (SELECT room_id FROM nickname_test_state) AND auth_user_id = auth.uid())
);
SELECT set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', true);
SELECT lives_ok(
  $$SELECT public.join_room((SELECT room_code FROM nickname_test_state), 'bob', 'voter');$$,
  'explicitly leaving releases the nickname for another identity'
);

RESET ROLE;
SELECT is(
  (SELECT nickname FROM public.room_members
    WHERE room_id = (SELECT room_id FROM nickname_test_state) AND role = 'host'),
  'Mina',
  'nickname checks preserve the host display name'
);

SELECT * FROM finish();
ROLLBACK;
