import { describe, expect, it, vi } from 'vitest';
import { createOnlineRoomFixture } from './room-fixtures.mjs';

function createFixtureClientFactory({ failJoinAt } = {}) {
  const clients = [];
  const members = [{ id: 'member-host', nickname: 'Host', role: 'host', online: true }];
  let joinCount = 0;
  const createClientFactory = () => {
    const client = {
      auth: {
        signInAnonymously: vi.fn(async () => {
          client.userId = `user-${clients.length + 1}`;
          return { data: { user: { id: client.userId } }, error: null };
        }),
        signOut: vi.fn(async () => ({ error: null })),
      },
      rpc: vi.fn(async (name, args) => {
        if (name === 'create_room') {
          return {
            data: {
              room: { id: 'room-1', code: 'A1B2C3D4', maxMembers: 100 },
              myMemberId: 'member-host',
              round: { id: 'round-1' },
              members,
            },
            error: null,
          };
        }
        if (name === 'join_room') {
          joinCount += 1;
          const joinIndex = joinCount - 1;
          if (joinIndex === failJoinAt) {
            return { data: null, error: { message: 'fixture join failed' } };
          }
          const joinedMember = { id: `member-${joinCount}`, nickname: args.p_nickname, role: args.p_role, online: true };
          members.push(joinedMember);
          return {
            data: { myMemberId: joinedMember.id, members: [...members] },
            error: null,
          };
        }
        if (name === 'build_room_snapshot') {
          return {
            data: {
              room: { id: 'room-1', code: 'A1B2C3D4', maxMembers: 100 },
              myMemberId: 'member-host',
              round: { id: 'round-1' },
              members: [...members],
            },
            error: null,
          };
        }
        if (name === 'heartbeat_member' || name === 'leave_room') {
          return { data: null, error: null };
        }
        throw new Error(`Unexpected RPC: ${name} ${JSON.stringify(args)}`);
      }),
    };
    clients.push(client);
    return client;
  };
  return { createClientFactory, clients };
}

describe('online room fixtures', () => {
  it('creates isolated online sessions with the requested voter/observer roles', async () => {
    const fake = createFixtureClientFactory();
    const fixture = await createOnlineRoomFixture({
      createClientFactory: fake.createClientFactory,
      url: 'http://127.0.0.1:54321',
      anonKey: 'local-anon-key',
      voterCount: 90,
      observerCount: 9,
    });

    expect(fixture.room.code).toMatch(/^[A-Z0-9]{8}$/);
    expect(fixture.members).toHaveLength(100);
    expect(fixture.members.filter(({ role }) => role === 'voter')).toHaveLength(90);
    expect(fixture.members.filter(({ role }) => role === 'observer')).toHaveLength(9);
    expect(fixture.members.every(({ online }) => online)).toBe(true);
    expect(fixture.snapshot.members).toHaveLength(100);
    expect(fake.clients[0].rpc).toHaveBeenCalledWith('build_room_snapshot', {
      p_room_id: 'room-1',
      p_user_id: 'user-2',
    });

    await fixture.heartbeat();
    expect(fake.clients.flatMap(({ rpc }) => rpc.mock.calls).filter(([name]) => name === 'heartbeat_member')).toHaveLength(100);

    await fixture.dispose();
    expect(fake.clients.flatMap(({ rpc }) => rpc.mock.calls).filter(([name]) => name === 'leave_room')).toHaveLength(100);
    expect(fake.clients.every(({ auth }) => auth.signOut.mock.calls.length === 1)).toBe(true);
  });

  it('rejects a partial join setup and disposes every session already created', async () => {
    const fake = createFixtureClientFactory({ failJoinAt: 4 });

    await expect(createOnlineRoomFixture({
      createClientFactory: fake.createClientFactory,
      url: 'http://127.0.0.1:54321',
      anonKey: 'local-anon-key',
      voterCount: 9,
      observerCount: 0,
      concurrency: 1,
    })).rejects.toThrow('fixture join failed');

    expect(fake.clients.length).toBeGreaterThan(1);
    expect(fake.clients.every(({ auth }) => auth.signOut.mock.calls.length === 1)).toBe(true);
    expect(fake.clients.slice(0, -1).every(({ rpc }) => rpc.mock.calls.some(([name]) => name === 'leave_room'))).toBe(true);
  });

  it('rejects requested sizes that do not match the member roles', async () => {
    const fake = createFixtureClientFactory();

    await expect(createOnlineRoomFixture({
      createClientFactory: fake.createClientFactory,
      url: 'http://127.0.0.1:54321',
      anonKey: 'local-anon-key',
      voterCount: 2,
      observerCount: 0,
      memberCount: 100,
    })).rejects.toThrow(/member count must equal/i);
    expect(fake.clients).toHaveLength(0);
  });
});
