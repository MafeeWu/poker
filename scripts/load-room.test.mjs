import { describe, expect, it, vi } from 'vitest';
import { createLoadProbe, validateRuntimeConfig } from './load-room.mjs';

function createFakeSupabase({
  failJoinAt,
  failVoteAt,
  subscriptionFailureAt,
  missingRevealMember,
  capacityFailureMessage = 'Room is full',
  leakHiddenVotes = false,
  unsubscribeFailureAt,
} = {}) {
  const clients = [];
  const channels = [];
  const joins = [];
  const votes = [];
  const revealSnapshots = [];
  const preRevealSnapshots = [];
  let joinCount = 0;
  let voteCount = 0;
  let revealed = false;
  const room = { id: 'room-1', code: 'AB12CD34', hostMemberId: 'member-host', maxMembers: 100 };
  const round = { id: 'round-1', status: 'voting' };
  const members = [];

  const snapshot = (client, status = round.status) => ({
    room,
    myMemberId: client.memberId,
    round: { ...round, status },
    myVote: client.vote ?? null,
    members: [...members],
    distribution: status === 'voting' && !leakHiddenVotes ? null : { '5': 91 },
  });

  const createClientFactory = () => {
    const client = {
      memberId: null,
      vote: null,
      auth: {
        signInAnonymously: vi.fn(async () => {
          client.userId = `user-${clients.length + 1}`;
          return { data: { user: { id: client.userId } }, error: null };
        }),
        getUser: vi.fn(async () => ({ data: { user: { id: client.userId } }, error: null })),
        signOut: vi.fn(async () => ({ error: null })),
      },
      rpc: vi.fn(async (name, args) => {
        if (name === 'create_room') {
          client.memberId = 'member-host';
          members.push({ id: client.memberId, nickname: args.p_nickname, role: 'host', online: true });
          return {
            data: {
              room,
              myMemberId: client.memberId,
              round: { ...round },
              members: [...members],
            },
            error: null,
          };
        }
        if (name === 'join_room') {
          joinCount += 1;
          joins.push(args);
          if (joinCount === failJoinAt) {
            return { data: null, error: { message: 'Transient join failure' } };
          }
          if (joinCount === 100) {
            return { data: null, error: { message: capacityFailureMessage } };
          }
          client.memberId = `member-${joinCount}`;
          members.push({ id: client.memberId, nickname: args.p_nickname, role: args.p_role, online: true });
          return { data: snapshot(client), error: null };
        }
        if (name === 'submit_vote') {
          voteCount += 1;
          votes.push(client.memberId);
          if (voteCount === failVoteAt) {
            return { data: null, error: { message: 'Vote RPC failed' } };
          }
          client.vote = '5';
          return { data: snapshot(client), error: null };
        }
        if (name === 'build_room_snapshot') {
          const value = snapshot(client, revealed ? 'revealed' : 'voting');
          if (revealed) {
            revealSnapshots.push({ userId: client.userId, distribution: value.distribution });
          } else {
            preRevealSnapshots.push(value);
          }
          return { data: value, error: null };
        }
        if (name === 'reveal_round') {
          revealed = true;
          for (const [index, channel] of channels.entries()) {
            if (index !== missingRevealMember) {
              channel.emitReveal();
            }
          }
          return { data: snapshot(client, 'revealed'), error: null };
        }
        if (name === 'heartbeat_member' || name === 'leave_room') {
          return { data: null, error: null };
        }
        throw new Error(`Unexpected RPC: ${name}`);
      }),
      channel: vi.fn((name) => {
        const channelIndex = channels.length;
        const channel = {
          name,
          callback: null,
          on: vi.fn((_event, _filter, callback) => {
            channel.callback = callback;
            return channel;
          }),
          subscribe: vi.fn((callback) => {
            queueMicrotask(() => callback(channelIndex === subscriptionFailureAt ? 'CHANNEL_ERROR' : 'SUBSCRIBED'));
            return channel;
          }),
          unsubscribe: vi.fn(async () => {
            if (channelIndex === unsubscribeFailureAt) {
              throw new Error('channel close failed');
            }
            return 'ok';
          }),
          emitReveal: () => channel.callback?.({ eventType: 'UPDATE' }),
        };
        channels.push(channel);
        return channel;
      }),
    };
    clients.push(client);
    return client;
  };

  return { createClientFactory, clients, channels, joins, votes, revealSnapshots, preRevealSnapshots };
}

describe('load-room probe harness', () => {
  it('fails with a clear error when Supabase configuration is missing', () => {
    expect(() => validateRuntimeConfig({})).toThrow(/Missing Supabase runtime configuration: SUPABASE_URL, SUPABASE_ANON_KEY/i);
  });

  it('requires a local Supabase URL rather than targeting a remote service', () => {
    expect(() => validateRuntimeConfig({
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_ANON_KEY: 'anon-key',
    })).toThrow(/requires local Supabase/i);
  });

  it('requires exactly 100 successful members and one explicit 101st capacity rejection', async () => {
    const fake = createFakeSupabase();
    const probe = createLoadProbe({
      createClientFactory: fake.createClientFactory,
      env: { SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_ANON_KEY: 'test-anon-key' },
      logger: { log: vi.fn(), warn: vi.fn() },
      propagationTimeoutMs: 20,
    });

    const result = await probe({ memberCount: 100, propagationTimeoutMs: 100 });

    expect(result).toMatchObject({
      success: true,
      joinedMembers: 100,
      rejectedJoins: 1,
      failedOperations: 0,
    });
    expect(fake.joins).toHaveLength(100);
    expect(fake.joins.filter(({ p_role }) => p_role === 'voter')).toHaveLength(91);
    expect(fake.joins.filter(({ p_role }) => p_role === 'observer')).toHaveLength(9);
    expect(fake.votes).toHaveLength(91);
    expect(fake.channels).toHaveLength(100);
    expect(fake.revealSnapshots).toHaveLength(100);
    expect(fake.revealSnapshots.every(({ distribution }) => distribution['5'] === 91)).toBe(true);
    expect(fake.preRevealSnapshots).toHaveLength(101);
    expect(fake.preRevealSnapshots.every(({ round: currentRound, distribution }) => currentRound.status === 'voting' && distribution === null)).toBe(true);
    expect(result.joinLatencyMs).toBeGreaterThanOrEqual(0);
    expect(result.voteLatencyMs).toBeGreaterThanOrEqual(0);
    expect(result.revealPropagationLatencyMs).toBeGreaterThanOrEqual(0);
    expect(fake.channels.every(({ unsubscribe }) => unsubscribe.mock.calls.length === 1)).toBe(true);
    expect(fake.clients.every(({ auth }) => auth.signOut.mock.calls.length === 1)).toBe(true);
  });

  it.each([
    ['a vote RPC failure', { failVoteAt: 4 }],
    ['a realtime subscription failure after channel creation', { subscriptionFailureAt: 8 }],
    ['a member missing the Reveal update', { missingRevealMember: 42 }],
    ['a leaked hidden vote', { leakHiddenVotes: true }],
  ])('fails for %s and still closes every created channel', async (_description, failure) => {
    const fake = createFakeSupabase(failure);
    const probe = createLoadProbe({
      createClientFactory: fake.createClientFactory,
      env: { SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_ANON_KEY: 'test-anon-key' },
      logger: { log: vi.fn(), warn: vi.fn() },
      propagationTimeoutMs: 20,
    });

    await expect(probe({ memberCount: 100, propagationTimeoutMs: 10 })).rejects.toThrow();
    expect(fake.channels.length).toBeGreaterThan(0);
    expect(fake.channels.every(({ unsubscribe }) => unsubscribe.mock.calls.length === 1)).toBe(true);
    expect(fake.clients.every(({ auth }) => auth.signOut.mock.calls.length === 1)).toBe(true);
  });

  it('fails a partial unexpected join setup and signs out its created sessions', async () => {
    const fake = createFakeSupabase({ failJoinAt: 7 });
    const probe = createLoadProbe({
      createClientFactory: fake.createClientFactory,
      env: { SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_ANON_KEY: 'test-anon-key' },
      logger: { log: vi.fn(), warn: vi.fn() },
    });

    await expect(probe({ memberCount: 100 })).rejects.toThrow(/transient join failure/i);
    expect(fake.channels).toHaveLength(0);
    expect(fake.clients.every(({ auth }) => auth.signOut.mock.calls.length === 1)).toBe(true);
  });

  it('fails when the 101st rejection is not an explicit capacity error', async () => {
    const fake = createFakeSupabase({ capacityFailureMessage: 'temporary database unavailable' });
    const probe = createLoadProbe({
      createClientFactory: fake.createClientFactory,
      env: { SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_ANON_KEY: 'test-anon-key' },
      logger: { log: vi.fn(), warn: vi.fn() },
    });

    await expect(probe({ memberCount: 100, propagationTimeoutMs: 100 })).rejects.toThrow(/unexpected reason/i);
    expect(fake.channels.every(({ unsubscribe }) => unsubscribe.mock.calls.length === 1)).toBe(true);
  });

  it('attempts to close every channel even when one unsubscribe throws', async () => {
    const fake = createFakeSupabase({ unsubscribeFailureAt: 7 });
    const probe = createLoadProbe({
      createClientFactory: fake.createClientFactory,
      env: { SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_ANON_KEY: 'test-anon-key' },
      logger: { log: vi.fn(), warn: vi.fn() },
      propagationTimeoutMs: 20,
    });

    await expect(probe({ memberCount: 100 })).rejects.toThrow(/cleanup failed/i);
    expect(fake.channels).toHaveLength(100);
    expect(fake.channels.every(({ unsubscribe }) => unsubscribe.mock.calls.length === 1)).toBe(true);
  });

  it('rejects non-100 run sizes rather than reporting partial success', async () => {
    const fake = createFakeSupabase();
    const probe = createLoadProbe({
      createClientFactory: fake.createClientFactory,
      env: { SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_ANON_KEY: 'test-anon-key' },
      logger: { log: vi.fn(), warn: vi.fn() },
    });

    await expect(probe({ memberCount: 99 })).rejects.toThrow(/exactly 100/i);
    expect(fake.clients).toHaveLength(0);
  });
});
