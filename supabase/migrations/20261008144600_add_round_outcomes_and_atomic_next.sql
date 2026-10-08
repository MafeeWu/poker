BEGIN;

ALTER TABLE public.rounds
  ADD COLUMN note text,
  ADD CONSTRAINT rounds_note_length_check
    CHECK (note IS NULL OR char_length(note) <= 240);

CREATE OR REPLACE FUNCTION public.build_room_snapshot(p_room_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
DECLARE
  v_room public.rooms%ROWTYPE;
  v_round public.rounds%ROWTYPE;
  v_members jsonb;
  v_recent_rounds jsonb := '[]'::jsonb;
  v_my_vote text;
  v_distribution jsonb;
  v_member_id uuid;
  v_submitted_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.room_members rm
    WHERE rm.room_id = p_room_id
      AND rm.auth_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Membership required';
  END IF;

  SELECT * INTO v_room
  FROM public.rooms
  WHERE id = p_room_id;

  SELECT * INTO v_round
  FROM public.rounds
  WHERE room_id = p_room_id
  ORDER BY round_number DESC
  LIMIT 1;

  SELECT rm.id INTO v_member_id
  FROM public.room_members rm
  WHERE rm.room_id = p_room_id
    AND rm.auth_user_id = auth.uid()
  LIMIT 1;

  SELECT value INTO v_my_vote
  FROM public.votes
  WHERE round_id = v_round.id
    AND member_id = v_member_id
  LIMIT 1;

  SELECT count(*)::integer INTO v_submitted_count
  FROM public.votes v
  JOIN public.room_members rm ON rm.id = v.member_id
  WHERE v.round_id = v_round.id
    AND rm.room_id = p_room_id
    AND rm.role IN ('host', 'voter');

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', rm.id,
      'nickname', rm.nickname,
      'role', rm.role,
      'joinedAt', rm.joined_at,
      'lastSeenAt', rm.last_seen_at,
      'online', rm.last_seen_at > now() - interval '90 seconds',
      'hasVoted', v.member_id IS NOT NULL,
      'vote', CASE
        WHEN v_round.status IN ('revealed', 'archived') THEN v.value
        ELSE NULL
      END
    )
    ORDER BY rm.joined_at ASC
  ) INTO v_members
  FROM public.room_members rm
  LEFT JOIN public.votes v
    ON v.round_id = v_round.id
   AND v.member_id = rm.id
  WHERE rm.room_id = p_room_id;

  IF v_round.status IN ('revealed', 'archived') THEN
    v_distribution := public.compute_distribution_json(v_round.id);
  ELSE
    v_distribution := NULL;
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'number', r.round_number,
      'status', r.status,
      'finalEstimate', r.final_estimate,
      'note', r.note,
      'startedAt', r.started_at,
      'revealedAt', r.revealed_at,
      'archivedAt', r.archived_at,
      'distribution', public.compute_distribution_json(r.id)
    )
    ORDER BY r.round_number DESC
  ) INTO v_recent_rounds
  FROM (
    SELECT *
    FROM public.rounds
    WHERE room_id = p_room_id AND status = 'archived'
    ORDER BY round_number DESC
    LIMIT 20
  ) r;

  RETURN jsonb_build_object(
    'room', jsonb_build_object(
      'id', v_room.id,
      'code', v_room.code,
      'name', v_room.name,
      'hostMemberId', v_room.host_member_id,
      'maxMembers', v_room.max_members,
      'createdAt', v_room.created_at
    ),
    'members', COALESCE(v_members, '[]'::jsonb),
    'round', jsonb_build_object(
      'id', v_round.id,
      'number', v_round.round_number,
      'status', v_round.status,
      'finalEstimate', v_round.final_estimate,
      'note', v_round.note,
      'startedAt', v_round.started_at,
      'revealedAt', v_round.revealed_at,
      'archivedAt', v_round.archived_at
    ),
    'myMemberId', v_member_id,
    'myVote', v_my_vote,
    'submittedCount', v_submitted_count,
    'distribution', v_distribution,
    'recentRounds', COALESCE(v_recent_rounds, '[]'::jsonb)
  );
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

  SELECT * INTO v_member
  FROM public.room_members
  WHERE room_id = p_room_id
    AND auth_user_id = v_user_id
    AND role = 'host'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Host membership required';
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
    AND role = 'host'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Host membership required';
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

REVOKE ALL ON FUNCTION public.update_round_outcome(uuid, uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_round_and_start_next_round(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_round_outcome(uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_round_and_start_next_round(uuid, uuid, text, text) TO authenticated;

COMMIT;
