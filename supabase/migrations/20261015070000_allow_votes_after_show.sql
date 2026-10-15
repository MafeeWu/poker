BEGIN;

CREATE OR REPLACE FUNCTION public.submit_vote(p_room_id uuid, p_round_id uuid, p_value text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_member public.room_members%ROWTYPE;
  v_round public.rounds%ROWTYPE;
  v_value text := btrim(p_value);
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  PERFORM 1 FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room not found';
  END IF;

  SELECT * INTO v_member
  FROM public.room_members
  WHERE room_id = p_room_id
    AND auth_user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Membership required';
  END IF;

  IF v_member.role NOT IN ('host', 'voter') THEN
    RAISE EXCEPTION 'Only voters may submit votes';
  END IF;

  SELECT * INTO v_round
  FROM public.rounds
  WHERE id = p_round_id
    AND room_id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Round not found';
  END IF;

  IF v_round.status NOT IN ('voting', 'revealed') THEN
    RAISE EXCEPTION 'Round is not accepting votes';
  END IF;

  IF v_value NOT IN ('0', '½', '1', '2', '3', '5', '8', '13', '21', '34', '55', '∞', '?') THEN
    RAISE EXCEPTION 'Invalid Fibonacci card';
  END IF;

  INSERT INTO public.votes (room_id, round_id, member_id, value)
  VALUES (p_room_id, p_round_id, v_member.id, v_value)
  ON CONFLICT (round_id, member_id)
  DO UPDATE SET value = EXCLUDED.value;

  UPDATE public.room_members
  SET last_voted_round_id = v_round.id
  WHERE id = v_member.id;

  RETURN public.build_room_snapshot(p_room_id, v_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_vote(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_vote(uuid, uuid, text) TO authenticated;
NOTIFY pgrst, 'reload schema';

COMMIT;
