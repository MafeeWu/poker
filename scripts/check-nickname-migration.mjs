import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const container = process.env.POKER_DB_CONTAINER || 'supabase_db_poker-mvp-local';
if (!/^supabase_db_[a-zA-Z0-9_-]+$/.test(container)) {
  throw new Error('Nickname migration checks require a local Supabase database container.');
}

const migration = readFileSync(new URL('../supabase/migrations/20261009061000_enforce_unique_room_nicknames.sql', import.meta.url), 'utf8')
  .replace(/^BEGIN;\s*/, '')
  .replace(/\s*COMMIT;\s*$/, '');
const roomId = randomUUID();
const otherRoomId = randomUUID();
const memberIds = Array.from({ length: 6 }, () => randomUUID());
const roundId = randomUUID();
const voteId = randomUUID();
const names = ['Mina', ' mina ', 'MINA', 'Mina (2)', 'Mina (3)', 'Mina'];
const members = memberIds.map((id, index) => (
  `('${id}', '${index === 5 ? otherRoomId : roomId}', '${randomUUID()}', '${names[index]}',
    '${index === 0 || index === 5 ? 'host' : index === 2 ? 'observer' : 'voter'}',
    '2020-01-01T00:00:0${index}Z')`
)).join(',\n');
const snapshot = `SELECT jsonb_build_object(
  'members', (SELECT jsonb_agg(jsonb_build_object(
    'id', id, 'room', room_id, 'user', auth_user_id, 'role', role,
    'joined', joined_at, 'seen', last_seen_at, 'marker', last_voted_round_id
  ) ORDER BY id) FROM public.room_members WHERE room_id IN ('${roomId}', '${otherRoomId}')),
  'hosts', (SELECT jsonb_agg(host_member_id ORDER BY id) FROM public.rooms
    WHERE id IN ('${roomId}', '${otherRoomId}')),
  'votes', (SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM public.votes v WHERE room_id = '${roomId}'),
  'names', (SELECT jsonb_agg(nickname ORDER BY joined_at, id) FROM public.room_members
    WHERE room_id IN ('${roomId}', '${otherRoomId}')),
  'duplicates', (SELECT count(*) FROM (
    SELECT room_id, lower(btrim(nickname)) FROM public.room_members
    GROUP BY room_id, lower(btrim(nickname)) HAVING count(*) > 1
  ) AS duplicates)
);`;

// Re-run the real migration inside a rollback-only transaction with legacy fixtures.
const result = spawnSync('docker', [
  'exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
  '-U', 'postgres', '-d', 'postgres',
], {
  encoding: 'utf8',
  input: `BEGIN;
    SET LOCAL statement_timeout = '15s';
    LOCK TABLE public.room_members IN SHARE ROW EXCLUSIVE MODE;
    DROP INDEX IF EXISTS public.room_members_room_nickname_key;
    INSERT INTO public.rooms (id, code, name) VALUES
      ('${roomId}', public.generate_room_code(), 'Nickname migration fixture'),
      ('${otherRoomId}', public.generate_room_code(), 'Other nickname fixture');
    INSERT INTO public.room_members (id, room_id, auth_user_id, nickname, role, joined_at)
      VALUES ${members};
    UPDATE public.rooms SET host_member_id = '${memberIds[0]}' WHERE id = '${roomId}';
    UPDATE public.rooms SET host_member_id = '${memberIds[5]}' WHERE id = '${otherRoomId}';
    INSERT INTO public.rounds (id, room_id, round_number, status)
      VALUES ('${roundId}', '${roomId}', 1, 'voting');
    INSERT INTO public.votes (id, room_id, round_id, member_id, value)
      VALUES ('${voteId}', '${roomId}', '${roundId}', '${memberIds[1]}', '8');
    UPDATE public.room_members SET last_voted_round_id = '${roundId}' WHERE id = '${memberIds[1]}';
    ${snapshot}
    ${migration}
    ${snapshot}
    ROLLBACK;`,
});
if (result.error) throw result.error;
assert.equal(result.status, 0, result.stderr || 'Nickname migration transaction failed');
const [before, after] = result.stdout.trim().split('\n').map((line) => JSON.parse(line));
assert.equal(after.duplicates, 0, 'All room-local nickname conflicts must be resolved');
assert.deepEqual(after.names, ['Mina', 'mina (4)', 'MINA (5)', 'Mina (2)', 'Mina (3)', 'Mina'],
  'The oldest name and existing suffixes must be preserved; other rooms may reuse the name');
assert.deepEqual(after.members, before.members, 'Renaming must preserve identities, roles, timestamps and vote markers');
assert.deepEqual(after.hosts, before.hosts, 'Renaming must preserve host references');
assert.deepEqual(after.votes, before.votes, 'Renaming must preserve vote records');
console.log('PASS nickname migration: legacy conflicts resolved without losing members, hosts or votes; fixtures rolled back');
