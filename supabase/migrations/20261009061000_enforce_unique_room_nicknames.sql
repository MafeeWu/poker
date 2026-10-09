BEGIN;

LOCK TABLE public.room_members IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  v_duplicate record;
  v_suffix integer;
  v_nickname text;
BEGIN
  FOR v_duplicate IN
    SELECT id, room_id, nickname
    FROM (
      SELECT id, room_id, nickname, joined_at,
        row_number() OVER (
          PARTITION BY room_id, lower(btrim(nickname))
          ORDER BY joined_at, id
        ) AS position
      FROM public.room_members
    ) AS ranked
    WHERE position > 1
    ORDER BY room_id, joined_at, id
  LOOP
    v_suffix := 2;
    LOOP
      v_nickname := btrim(v_duplicate.nickname) || ' (' || v_suffix || ')';
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.room_members
        WHERE room_id = v_duplicate.room_id
          AND lower(btrim(nickname)) = lower(v_nickname)
      );
      v_suffix := v_suffix + 1;
    END LOOP;

    UPDATE public.room_members SET nickname = v_nickname WHERE id = v_duplicate.id;
  END LOOP;
END;
$$;

CREATE UNIQUE INDEX room_members_room_nickname_key
ON public.room_members (room_id, lower(btrim(nickname)));

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

  IF EXISTS (
    SELECT 1 FROM public.room_members
    WHERE room_id = v_room.id
      AND lower(btrim(nickname)) = lower(btrim(p_nickname))
      AND auth_user_id <> v_user_id
  ) THEN
    RAISE EXCEPTION 'Nickname is already in use in this room. Please choose another.';
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

COMMIT;
