BEGIN;

REVOKE EXECUTE ON FUNCTION public.archive_round(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.start_next_round(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

COMMIT;
