BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{8}$'),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  host_member_id uuid,
  max_members integer NOT NULL DEFAULT 100 CHECK (max_members BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.room_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  auth_user_id uuid NOT NULL,
  nickname text NOT NULL CHECK (length(trim(nickname)) > 0),
  role text NOT NULL CHECK (role IN ('host', 'voter', 'observer')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, auth_user_id)
);

ALTER TABLE public.rooms
  ADD CONSTRAINT rooms_host_member_id_fkey
  FOREIGN KEY (host_member_id) REFERENCES public.room_members(id) ON DELETE SET NULL;

CREATE TABLE public.rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  round_number integer NOT NULL CHECK (round_number > 0),
  status text NOT NULL CHECK (status IN ('voting', 'revealed', 'archived')),
  final_estimate text,
  started_at timestamptz NOT NULL DEFAULT now(),
  revealed_at timestamptz,
  archived_at timestamptz,
  UNIQUE (room_id, round_number),
  CHECK (final_estimate IS NULL OR length(trim(final_estimate)) > 0)
);

CREATE TABLE public.votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  round_id uuid NOT NULL REFERENCES public.rounds(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.room_members(id) ON DELETE CASCADE,
  value text NOT NULL CHECK (value IN ('0', '½', '1', '2', '3', '5', '8', '13', '21', '34', '55', '∞', '?')),
  UNIQUE (round_id, member_id)
);

CREATE OR REPLACE FUNCTION public.trim_old_archived_rounds()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'archived' THEN
    DELETE FROM public.rounds r
    WHERE r.room_id = NEW.room_id
      AND r.status = 'archived'
      AND r.id <> NEW.id
      AND r.id NOT IN (
        SELECT id
        FROM public.rounds
        WHERE room_id = NEW.room_id
          AND status = 'archived'
        ORDER BY round_number DESC
        LIMIT 20
      );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER rounds_trim_archived_history
AFTER INSERT OR UPDATE OF status, round_number
ON public.rounds
FOR EACH ROW
WHEN (NEW.status = 'archived')
EXECUTE FUNCTION public.trim_old_archived_rounds();

CREATE INDEX idx_rooms_code ON public.rooms(code);
CREATE INDEX idx_room_members_room_membership ON public.room_members(room_id, auth_user_id);
CREATE INDEX idx_room_members_online ON public.room_members(room_id, last_seen_at);
CREATE INDEX idx_rounds_current ON public.rounds(room_id, round_number DESC, status);
CREATE INDEX idx_rounds_history ON public.rounds(room_id, started_at DESC, round_number DESC);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER rooms_updated_at
BEFORE UPDATE ON public.rooms
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

COMMIT;
