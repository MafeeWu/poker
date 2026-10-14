BEGIN;

CREATE OR REPLACE FUNCTION public.reveal_round(p_room_id uuid, p_round_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_member public.room_members%ROWTYPE;
  v_round public.rounds%ROWTYPE;
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
    RAISE EXCEPTION 'Voting privileges required';
  END IF;

  SELECT * INTO v_round
  FROM public.rounds
  WHERE id = p_round_id
    AND room_id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Round not found';
  END IF;
  IF v_round.status IN ('revealed', 'archived') THEN
    RETURN public.build_room_snapshot(p_room_id, v_user_id);
  END IF;

  UPDATE public.rounds
  SET status = 'revealed',
      revealed_at = now()
  WHERE id = v_round.id;

  RETURN public.build_room_snapshot(p_room_id, v_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_round_outcome(
  p_room_id uuid,
  p_round_id uuid,
  p_final_estimate text,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_member public.room_members%ROWTYPE;
  v_round public.rounds%ROWTYPE;
  v_final_estimate text;
  v_note text;
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
    RAISE EXCEPTION 'Voting privileges required';
  END IF;

  SELECT * INTO v_round
  FROM public.rounds
  WHERE id = p_round_id
    AND room_id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Round not found';
  END IF;
  IF v_round.status <> 'revealed' THEN
    RAISE EXCEPTION 'Round must be revealed before updating its outcome';
  END IF;

  IF p_final_estimate IS NULL THEN
    v_final_estimate := NULL;
  ELSE
    v_final_estimate := btrim(p_final_estimate);
    IF v_final_estimate = '' THEN
      RAISE EXCEPTION 'Final estimate cannot be empty';
    END IF;
  END IF;

  v_note := nullif(btrim(p_note), '');
  IF v_note IS NOT NULL AND char_length(v_note) > 240 THEN
    RAISE EXCEPTION 'Note must be 240 characters or fewer';
  END IF;

  UPDATE public.rounds
  SET final_estimate = v_final_estimate,
      note = v_note
  WHERE id = v_round.id;

  RETURN public.build_room_snapshot(p_room_id, v_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_round_and_start_next_round(
  p_room_id uuid,
  p_round_id uuid,
  p_final_estimate text,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_room public.rooms%ROWTYPE;
  v_member public.room_members%ROWTYPE;
  v_round public.rounds%ROWTYPE;
  v_current_round_number integer;
  v_final_estimate text;
  v_note text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_room
  FROM public.rooms
  WHERE id = p_room_id
  FOR UPDATE;

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
    RAISE EXCEPTION 'Voting privileges required';
  END IF;

  SELECT * INTO v_round
  FROM public.rounds
  WHERE id = p_round_id
    AND room_id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Round not found';
  END IF;
  IF v_round.status = 'archived' THEN
    RETURN public.build_room_snapshot(p_room_id, v_user_id);
  END IF;
  IF v_round.status <> 'revealed' THEN
    RAISE EXCEPTION 'Round must be revealed before completion';
  END IF;

  SELECT max(round_number) INTO v_current_round_number
  FROM public.rounds
  WHERE room_id = p_room_id;

  IF v_round.round_number <> v_current_round_number THEN
    RAISE EXCEPTION 'Only the current round can be completed';
  END IF;

  v_final_estimate := btrim(p_final_estimate);
  IF v_final_estimate IS NULL OR v_final_estimate = '' THEN
    RAISE EXCEPTION 'Final estimate is required';
  END IF;

  v_note := nullif(btrim(p_note), '');
  IF v_note IS NOT NULL AND char_length(v_note) > 240 THEN
    RAISE EXCEPTION 'Note must be 240 characters or fewer';
  END IF;

  UPDATE public.rounds
  SET status = 'archived',
      final_estimate = v_final_estimate,
      note = v_note,
      archived_at = now()
  WHERE id = v_round.id;

  INSERT INTO public.rounds (room_id, round_number, status, started_at)
  VALUES (p_room_id, v_round.round_number + 1, 'voting', now());

  RETURN public.build_room_snapshot(p_room_id, v_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.reveal_round(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_round_outcome(uuid, uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_round_and_start_next_round(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reveal_round(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_round_outcome(uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_round_and_start_next_round(uuid, uuid, text, text) TO authenticated;

DROP FUNCTION public.transfer_host(uuid, uuid);
NOTIFY pgrst, 'reload schema';

COMMIT;
