CREATE TABLE IF NOT EXISTS public.poker_card_seed (
  value text PRIMARY KEY
);

TRUNCATE public.poker_card_seed;

INSERT INTO public.poker_card_seed (value)
VALUES
  ('0'),
  ('½'),
  ('1'),
  ('2'),
  ('3'),
  ('5'),
  ('8'),
  ('13'),
  ('21'),
  ('34'),
  ('55'),
  ('∞'),
  ('?')
ON CONFLICT (value) DO NOTHING;
