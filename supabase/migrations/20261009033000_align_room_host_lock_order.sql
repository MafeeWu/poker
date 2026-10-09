BEGIN;

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

  -- Room-changing operations lock the room before any member, including atomic Next.
  PERFORM 1 FROM public.rooms WHERE id = p_room_id FOR UPDATE;

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

  -- Host departure also changes rooms.host_member_id, so it shares the same order.
  PERFORM 1 FROM public.rooms WHERE id = p_room_id FOR UPDATE;

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

COMMIT;
