BEGIN;

ALTER TABLE public.room_members
  ADD COLUMN last_voted_round_id uuid
  REFERENCES public.rounds(id)
  ON DELETE SET NULL;

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

  IF v_round.status <> 'voting' THEN
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

COMMIT;
