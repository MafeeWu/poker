BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(5);

SELECT is(
  (SELECT count(*)::bigint FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'rooms'),
  1::bigint,
  'room metadata changes are published to Realtime'
);

SELECT is(
  (SELECT count(*)::bigint FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'room_members'),
  1::bigint,
  'membership changes are published to Realtime'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'room_members'
      AND (attnames IS NULL OR 'last_voted_round_id'::name = ANY(attnames))
  ),
  'published membership changes include the safe vote-status marker'
);

SELECT is(
  (SELECT count(*)::bigint FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'rounds'),
  1::bigint,
  'round changes are published to Realtime'
);

SELECT is(
  (SELECT count(*)::bigint FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'votes'),
  0::bigint,
  'individual vote rows are not published'
);

SELECT * FROM finish();

ROLLBACK;
