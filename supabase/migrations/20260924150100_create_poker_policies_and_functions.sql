BEGIN;

CREATE OR REPLACE FUNCTION public.generate_room_code()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  v_index integer;
BEGIN
  LOOP
    v_code := '';
    FOR v_index IN 1..8 LOOP
      v_code := v_code || substr(v_chars, floor(random() * length(v_chars))::int + 1, 1);
    END LOOP;

    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.rooms WHERE code = v_code
    );
  END LOOP;

  RETURN v_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.compute_distribution_json(p_round_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
WITH valid_cards AS (
  SELECT * FROM (VALUES
    ('0'), ('½'), ('1'), ('2'), ('3'), ('5'), ('8'), ('13'), ('21'), ('34'), ('55'), ('∞'), ('?')
  ) AS cards(value)
),
counts AS (
  SELECT vc.value,
         count(v.value) AS vote_count
  FROM valid_cards vc
  LEFT JOIN public.votes v
    ON v.round_id = p_round_id
   AND v.value = vc.value
  GROUP BY vc.value
)
SELECT COALESCE(jsonb_object_agg(value, vote_count), '{}'::jsonb)
FROM counts;
$$;

CREATE OR REPLACE FUNCTION public.build_room_snapshot(p_room_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
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
BEGIN
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
    AND rm.auth_user_id = p_user_id
  LIMIT 1;

  SELECT value INTO v_my_vote
  FROM public.votes
  WHERE round_id = v_round.id
    AND member_id = v_member_id
  LIMIT 1;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', rm.id,
      'nickname', rm.nickname,
      'role', rm.role,
      'joinedAt', rm.joined_at,
      'lastSeenAt', rm.last_seen_at,
      'online', rm.last_seen_at > now() - interval '90 seconds'
    )
    ORDER BY rm.joined_at ASC
  ) INTO v_members
  FROM public.room_members rm
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
    'myVote', v_my_vote,
    'distribution', v_distribution,
    'recentRounds', COALESCE(v_recent_rounds, '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.user_is_room_member(p_room_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.room_members rm
    WHERE rm.room_id = p_room_id
      AND rm.auth_user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.create_room(p_name text, p_nickname text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_room_id uuid;
  v_member_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'Room name is required';
  END IF;

  IF p_nickname IS NULL OR btrim(p_nickname) = '' THEN
    RAISE EXCEPTION 'Nickname is required';
  END IF;

  INSERT INTO public.rooms (code, name, max_members, created_at, updated_at)
  VALUES (public.generate_room_code(), btrim(p_name), 100, now(), now())
  RETURNING id INTO v_room_id;

  INSERT INTO public.room_members (room_id, auth_user_id, nickname, role, joined_at, last_seen_at)
  VALUES (v_room_id, v_user_id, btrim(p_nickname), 'host', now(), now())
  RETURNING id INTO v_member_id;

  UPDATE public.rooms
  SET host_member_id = v_member_id,
      updated_at = now()
  WHERE id = v_room_id;

  INSERT INTO public.rounds (room_id, round_number, status, started_at)
  VALUES (v_room_id, 1, 'voting', now());

  RETURN public.build_room_snapshot(v_room_id, v_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.join_room(p_code text, p_nickname text, p_role text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_room public.rooms%ROWTYPE;
  v_existing_member_id uuid;
  v_role text := lower(trim(p_role));
  v_active_count integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_nickname IS NULL OR btrim(p_nickname) = '' THEN
    RAISE EXCEPTION 'Nickname is required';
  END IF;

  IF v_role NOT IN ('voter', 'observer') THEN
    RAISE EXCEPTION 'Role must be voter or observer';
  END IF;

  SELECT * INTO v_room
  FROM public.rooms
  WHERE upper(code) = upper(trim(p_code))
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room not found';
  END IF;

  SELECT count(*) INTO v_active_count
  FROM public.room_members
  WHERE room_id = v_room.id
    AND last_seen_at > now() - interval '90 seconds';

  IF v_active_count >= v_room.max_members THEN
    RAISE EXCEPTION 'Room is full';
  END IF;

  SELECT id INTO v_existing_member_id
  FROM public.room_members
  WHERE room_id = v_room.id
    AND auth_user_id = v_user_id;

  IF v_existing_member_id IS NOT NULL THEN
    UPDATE public.room_members
    SET nickname = btrim(p_nickname),
        role = v_role,
        last_seen_at = now()
    WHERE id = v_existing_member_id;
  ELSE
    INSERT INTO public.room_members (room_id, auth_user_id, nickname, role, joined_at, last_seen_at)
    VALUES (v_room.id, v_user_id, btrim(p_nickname), v_role, now(), now());
  END IF;

  RETURN public.build_room_snapshot(v_room.id, v_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.heartbeat_member(p_room_id uuid, p_member_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  UPDATE public.room_members
  SET last_seen_at = now()
  WHERE room_id = p_room_id
    AND id = p_member_id
    AND auth_user_id = auth.uid();
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

  RETURN public.build_room_snapshot(p_room_id, v_user_id);
END;
$$;

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

  SELECT * INTO v_member
  FROM public.room_members
  WHERE room_id = p_room_id
    AND auth_user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Membership required';
  END IF;

  IF v_member.role <> 'host' THEN
    RAISE EXCEPTION 'Host privileges required';
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
  WHERE id = p_round_id;

  RETURN public.build_room_snapshot(p_room_id, v_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_round(p_room_id uuid, p_round_id uuid, p_final_estimate text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_member public.room_members%ROWTYPE;
  v_round public.rounds%ROWTYPE;
  v_estimate text := trim(p_final_estimate);
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

  IF v_member.role <> 'host' THEN
    RAISE EXCEPTION 'Host privileges required';
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
    RAISE EXCEPTION 'Round must be revealed before archiving';
  END IF;

  IF v_estimate = '' THEN
    RAISE EXCEPTION 'Final estimate is required';
  END IF;

  UPDATE public.rounds
  SET status = 'archived',
      final_estimate = v_estimate,
      archived_at = now()
  WHERE id = p_round_id;

  DELETE FROM public.rounds r
  WHERE r.room_id = p_room_id
    AND r.status = 'archived'
    AND r.id NOT IN (
      SELECT id
      FROM public.rounds
      WHERE room_id = p_room_id
        AND status = 'archived'
      ORDER BY round_number DESC
      LIMIT 20
    );

  RETURN public.build_room_snapshot(p_room_id, v_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.start_next_round(p_room_id uuid, p_round_id uuid)
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

  SELECT * INTO v_member
  FROM public.room_members
  WHERE room_id = p_room_id
    AND auth_user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Membership required';
  END IF;

  IF v_member.role <> 'host' THEN
    RAISE EXCEPTION 'Host privileges required';
  END IF;

  SELECT * INTO v_round
  FROM public.rounds
  WHERE id = p_round_id
    AND room_id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Round not found';
  END IF;

  IF v_round.status <> 'archived' THEN
    RAISE EXCEPTION 'Only archived rounds can start the next round';
  END IF;

  INSERT INTO public.rounds (room_id, round_number, status, started_at)
  VALUES (p_room_id, v_round.round_number + 1, 'voting', now());

  RETURN public.build_room_snapshot(p_room_id, v_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.transfer_host(p_room_id uuid, p_member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_current_host public.room_members%ROWTYPE;
  v_target public.room_members%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_current_host
  FROM public.room_members
  WHERE room_id = p_room_id
    AND auth_user_id = v_user_id
    AND role = 'host'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Host membership required';
  END IF;

  SELECT * INTO v_target
  FROM public.room_members
  WHERE room_id = p_room_id
    AND id = p_member_id
    AND role = 'voter'
    AND last_seen_at > now() - interval '90 seconds'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target member must be a current voter in the same room';
  END IF;

  UPDATE public.room_members
  SET role = 'voter'
  WHERE room_id = p_room_id
    AND auth_user_id = v_user_id
    AND role = 'host';

  UPDATE public.room_members
  SET role = 'host'
  WHERE room_id = p_room_id
    AND id = p_member_id
    AND role = 'voter';

  UPDATE public.rooms
  SET host_member_id = p_member_id,
      updated_at = now()
  WHERE id = p_room_id;

  RETURN public.build_room_snapshot(p_room_id, v_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_room(p_room_id uuid, p_member_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_member public.room_members%ROWTYPE;
  v_next_host uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_member
  FROM public.room_members
  WHERE room_id = p_room_id
    AND id = p_member_id
    AND auth_user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Membership required';
  END IF;

  DELETE FROM public.room_members
  WHERE room_id = p_room_id
    AND id = p_member_id;

  IF EXISTS (
    SELECT 1
    FROM public.rooms
    WHERE id = p_room_id
      AND host_member_id = p_member_id
  ) THEN
    SELECT rm.id INTO v_next_host
    FROM public.room_members rm
    WHERE rm.room_id = p_room_id
    ORDER BY rm.joined_at ASC, rm.id
    LIMIT 1;

    IF v_next_host IS NOT NULL THEN
      UPDATE public.room_members
      SET role = 'host'
      WHERE id = v_next_host;

      UPDATE public.rooms
      SET host_member_id = v_next_host,
          updated_at = now()
      WHERE id = p_room_id;
    ELSE
      DELETE FROM public.rooms
      WHERE id = p_room_id;
    END IF;
  END IF;
END;
$$;

ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rooms_visible_to_members"
ON public.rooms
FOR SELECT
USING (public.user_is_room_member(rooms.id));

CREATE POLICY "rounds_visible_to_members"
ON public.rounds
FOR SELECT
USING (public.user_is_room_member(rounds.room_id));

CREATE POLICY "room_members_visible_to_members"
ON public.room_members
FOR SELECT
USING (public.user_is_room_member(room_members.room_id));

CREATE POLICY "votes_visible_own_during_voting"
ON public.votes
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.room_members rm
    WHERE rm.id = votes.member_id
      AND rm.auth_user_id = auth.uid()
  )
  AND EXISTS (
    SELECT 1
    FROM public.rounds r
    WHERE r.id = votes.round_id
      AND r.status = 'voting'
  )
  AND votes.member_id IN (
    SELECT rm.id
    FROM public.room_members rm
    WHERE rm.room_id = votes.room_id
      AND rm.auth_user_id = auth.uid()
  )
);

CREATE POLICY "votes_visible_after_reveal"
ON public.votes
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.rounds r
    WHERE r.id = votes.round_id
      AND r.status IN ('revealed', 'archived')
  )
  AND EXISTS (
    SELECT 1
    FROM public.room_members rm
    WHERE rm.room_id = votes.room_id
      AND rm.auth_user_id = auth.uid()
  )
);

COMMIT;
