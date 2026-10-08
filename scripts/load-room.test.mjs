import { describe, it, expect, vi } from 'vitest';
import { createLoadProbe, validateRuntimeConfig } from './load-room.mjs';

describe('load-room probe harness', () => {
  it('requires Supabase runtime configuration', () => {
    expect(() => validateRuntimeConfig({})).toThrow(/SUPABASE_URL|SUPABASE_ANON_KEY/i);
  });

  it('builds 100 join attempts with one explicit rejection', async () => {
    const joins = [];
    const createdChannels = [];
    const fakeSupabase = {
      auth: {
        signInAnonymously: vi.fn(async () => ({ error: null })),
      },
      from: vi.fn((table) => ({
        insert: vi.fn(() => ({ error: null })),
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          })),
        })),
      })),
      channel: vi.fn((name) => {
        const channel = {
          on: vi.fn(() => channel),
          subscribe: vi.fn(async () => ({ status: 'SUBSCRIBED' })),
          unsubscribe: vi.fn(async () => undefined),
        };
        createdChannels.push(channel);
        return channel;
      }),
      rpc: vi.fn(async (name, args) => {
        if (name === 'create_room') {
          return { room: { id: 'room-1', code: 'AB12CD34', name: 'Sprint 24', hostMemberId: 'member-host', maxMembers: 100 }, myMemberId: 'member-host', members: [{ id: 'member-host', nickname: 'Host', role: 'host', joinedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), online: true }], round: { id: 'round-1', number: 1, status: 'voting', finalEstimate: null, startedAt: new Date().toISOString(), revealedAt: null, archivedAt: null }, myVote: null, submittedCount: 0, distribution: null, recentRounds: []};
        }
        if (name === 'join_room') {
          const memberId = `member-${joins.length + 1}`;
          const shouldReject = joins.length >= 99;
          joins.push({ memberId, shouldReject, args });
          if (shouldReject) {
            throw new Error('Room is full');
          }
          return {
            room: { id: 'room-1', code: 'AB12CD34', name: 'Sprint 24', hostMemberId: 'member-host', maxMembers: 100 },
            myMemberId: memberId,
            members: [{ id: 'member-host', nickname: 'Host', role: 'host', joinedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), online: true }].concat(Array.from({ length: joins.length }, (_, index) => ({ id: `member-${index + 1}`, nickname: `Voter ${index + 1}`, role: 'voter', joinedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), online: true }))),
            round: { id: 'round-1', number: 1, status: 'voting', finalEstimate: null, startedAt: new Date().toISOString(), revealedAt: null, archivedAt: null },
            myVote: null,
            submittedCount: 0,
            distribution: null,
            recentRounds: []
          };
        }
        if (name === 'submit_vote') {
          return {
            room: { id: 'room-1', code: 'AB12CD34', name: 'Sprint 24', hostMemberId: 'member-host', maxMembers: 100 },
            myMemberId: 'member-1',
            members: [{ id: 'member-host', nickname: 'Host', role: 'host', joinedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), online: true }],
            round: { id: 'round-1', number: 1, status: 'voting', finalEstimate: null, startedAt: new Date().toISOString(), revealedAt: null, archivedAt: null },
            myVote: '5',
            submittedCount: 1,
            distribution: { '5': 100, '0': 0, '½': 0, '1': 0, '2': 0, '3': 0, '8': 0, '13': 0, '21': 0, '34': 0, '55': 0, '∞': 0, '?': 0 },
            recentRounds: []
          };
        }
        if (name === 'reveal_round') {
          return {
            room: { id: 'room-1', code: 'AB12CD34', name: 'Sprint 24', hostMemberId: 'member-host', maxMembers: 100 },
            myMemberId: 'member-1',
            members: [{ id: 'member-host', nickname: 'Host', role: 'host', joinedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), online: true }],
            round: { id: 'round-1', number: 1, status: 'revealed', finalEstimate: null, startedAt: new Date().toISOString(), revealedAt: new Date().toISOString(), archivedAt: null },
            myVote: '5',
            submittedCount: 1,
            distribution: { '5': 100, '0': 0, '½': 0, '1': 0, '2': 0, '3': 0, '8': 0, '13': 0, '21': 0, '34': 0, '55': 0, '∞': 0, '?': 0 },
            recentRounds: []
          };
        }
        throw new Error(`Unhandled rpc ${name}`);
      }),
    };

    const probe = createLoadProbe({
      supabase: fakeSupabase,
      logger: { log: () => undefined, warn: () => undefined },
      concurrency: 10,
      env: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon-key' },
    });
    const result = await probe({ roomCode: 'AB12CD34', memberCount: 101, hostNickname: 'Host', voterNicknamePrefix: 'Voter', observerNicknamePrefix: 'Observer' });

    expect(result.success).toBe(true);
    expect(result.joinedMembers).toBe(100);
    expect(result.rejectedJoins).toBe(1);
    expect(createdChannels.length).toBeGreaterThan(0);
    createdChannels.forEach((channel) => {
      expect(channel.unsubscribe).toHaveBeenCalled();
    });
  });
});
