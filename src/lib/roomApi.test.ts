import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
  return {};
});

import { getSupabaseClient } from './supabase';
import {
  completeRoundAndStartNextRound,
  createRoom,
  heartbeatMember,
  normalizeRoomSnapshot,
  submitVote,
  updateRoundOutcome,
} from './roomApi';

const supabase = getSupabaseClient();

const validSnapshot = {
  room: {
    id: 'room-1',
    code: 'P4KER09',
    name: 'Planning Room',
    hostMemberId: 'member-1',
    maxMembers: 100,
    createdAt: '2026-09-24T00:00:00.000Z',
  },
  myMemberId: 'member-1',
  members: [
    {
      id: 'member-1',
      nickname: 'Alice',
      role: 'host' as const,
      joinedAt: '2026-09-24T00:00:00.000Z',
      lastSeenAt: '2026-09-24T00:00:00.000Z',
      online: true,
      hasVoted: false,
      vote: null,
    },
  ],
  round: {
    id: 'round-1',
    number: 1,
    status: 'voting' as const,
    finalEstimate: null,
    note: null,
    startedAt: '2026-09-24T00:00:00.000Z',
    revealedAt: null,
    archivedAt: null,
  },
  myVote: null,
  submittedCount: 0,
  distribution: null,
  recentRounds: [{
    id: 'round-0',
    number: 0,
    status: 'archived' as const,
    finalEstimate: '3',
    note: 'Earlier round',
    startedAt: '2026-09-23T00:00:00.000Z',
    revealedAt: '2026-09-23T00:05:00.000Z',
    archivedAt: '2026-09-23T00:06:00.000Z',
    distribution: {
      '0': 0, '½': 0, '1': 0, '2': 0, '3': 1, '5': 0, '8': 0,
      '13': 0, '21': 0, '34': 0, '55': 0, '∞': 0, '?': 0,
    },
  }],
};

describe('roomApi', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a room after anonymous sign-in and returns the snapshot', async () => {
    const signIn = vi.spyOn(supabase.auth, 'signInAnonymously').mockResolvedValue({
      data: { user: { id: 'user-1' }, session: null },
      error: null,
    } as any);
    const rpc = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: {
        room: {
          id: 'room-1',
          code: 'P4KER09',
          name: 'Planning Room',
          hostMemberId: 'member-1',
          maxMembers: 100,
          createdAt: '2026-09-24T00:00:00.000Z',
        },
        myMemberId: 'member-1',
        members: [
          {
            id: 'member-1',
            nickname: 'Alice',
            role: 'host',
            joinedAt: '2026-09-24T00:00:00.000Z',
            lastSeenAt: '2026-09-24T00:00:00.000Z',
            online: true,
            hasVoted: false,
            vote: null,
          },
        ],
        round: {
          id: 'round-1',
          number: 1,
          status: 'voting',
          finalEstimate: null,
          note: null,
          startedAt: '2026-09-24T00:00:00.000Z',
          revealedAt: null,
          archivedAt: null,
        },
        myVote: null,
        submittedCount: 0,
        distribution: null,
        recentRounds: validSnapshot.recentRounds,
      },
      error: null,
    } as any);

    const snapshot = await createRoom(' Planning Room ', '  Alice ');

    expect(signIn).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('create_room', {
      p_name: 'Planning Room',
      p_nickname: 'Alice',
    });
    expect(snapshot.room.name).toBe('Planning Room');
    expect(snapshot.members[0].nickname).toBe('Alice');
  });

  it('maps a Supabase error to a message-preserving Error', async () => {
    vi.spyOn(supabase.auth, 'signInAnonymously').mockResolvedValue({
      data: { user: { id: 'user-1' }, session: null },
      error: null,
    } as any);
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: null,
      error: { message: 'Room name is required' },
    } as any);

    await expect(createRoom('Planning Room', 'Alice')).rejects.toThrow('Room name is required');
  });

  it('reuses the current anonymous session when submitting a vote', async () => {
    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
      error: null,
    } as any);
    const signIn = vi.spyOn(supabase.auth, 'signInAnonymously').mockResolvedValue({
      data: { user: { id: 'user-2' }, session: null },
      error: null,
    } as any);
    const rpc = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: validSnapshot,
      error: null,
    } as any);

    await submitVote('room-1', 'round-1', '5');

    expect(signIn).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('submit_vote', {
      p_room_id: 'room-1',
      p_round_id: 'round-1',
      p_value: '5',
    });
  });

  it('rejects malformed cards before any network call', async () => {
    const signIn = vi.spyOn(supabase.auth, 'signInAnonymously');
    const rpc = vi.spyOn(supabase, 'rpc');

    await expect(submitVote('room-1', 'round-1', 'invalid' as any)).rejects.toThrow('Invalid Fibonacci card');
    expect(signIn).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects a snapshot with a missing room id', () => {
    const snapshot = { ...validSnapshot, room: { ...validSnapshot.room, id: undefined } };

    expect(() => normalizeRoomSnapshot(snapshot)).toThrow('room.id');
  });

  it('rejects a snapshot with a missing round status', () => {
    const snapshot = { ...validSnapshot, round: { ...validSnapshot.round, status: undefined } };

    expect(() => normalizeRoomSnapshot(snapshot)).toThrow('round.status');
  });

  it('normalizes a valid snapshot without inventing values', () => {
    expect(normalizeRoomSnapshot(validSnapshot)).toEqual(validSnapshot);
  });

  it('rejects a member with missing or non-boolean vote status', () => {
    const member = validSnapshot.members[0];
    const { hasVoted: _hasVoted, ...withoutHasVoted } = member;

    expect(() => normalizeRoomSnapshot({
      ...validSnapshot,
      members: [withoutHasVoted],
    })).toThrow('members[0].hasVoted');
    expect(() => normalizeRoomSnapshot({
      ...validSnapshot,
      members: [{ ...member, hasVoted: 'yes' }],
    })).toThrow('members[0].hasVoted');
  });

  it('rejects invalid member cards', () => {
    expect(() => normalizeRoomSnapshot({
      ...validSnapshot,
      round: { ...validSnapshot.round, status: 'revealed' },
      members: [{ ...validSnapshot.members[0], vote: 'invalid' }],
    })).toThrow('members[0].vote');
  });

  it('rejects a revealed member card while the current round is voting', () => {
    expect(() => normalizeRoomSnapshot({
      ...validSnapshot,
      members: [{ ...validSnapshot.members[0], vote: '5' }],
    })).toThrow('members[0].vote');
  });

  it('accepts a valid revealed member card', () => {
    const snapshot = {
      ...validSnapshot,
      round: { ...validSnapshot.round, status: 'revealed' },
      members: [{ ...validSnapshot.members[0], hasVoted: true, vote: '5' }],
    };

    expect(normalizeRoomSnapshot(snapshot).members[0]).toMatchObject({ hasVoted: true, vote: '5' });
  });

  it('rejects an overlong Unicode Note', () => {
    const note = '🎴'.repeat(241);

    expect(() => normalizeRoomSnapshot({
      ...validSnapshot,
      round: { ...validSnapshot.round, note },
    })).toThrow('round.note');
  });

  it('updates the revealed round outcome using the RPC contract', async () => {
    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
      error: null,
    } as any);
    const rpc = vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: validSnapshot, error: null } as any);

    await updateRoundOutcome('room-1', 'round-1', ' 5 ', '  Investigate retries  ');

    expect(rpc).toHaveBeenCalledWith('update_round_outcome', {
      p_room_id: 'room-1',
      p_round_id: 'round-1',
      p_final_estimate: '5',
      p_note: 'Investigate retries',
    });
  });

  it('completes the round and starts the next one using the RPC contract', async () => {
    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
      error: null,
    } as any);
    const rpc = vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: validSnapshot, error: null } as any);

    await completeRoundAndStartNextRound('room-1', 'round-1', '5', 'Investigate retries');

    expect(rpc).toHaveBeenCalledWith('complete_round_and_start_next_round', {
      p_room_id: 'room-1',
      p_round_id: 'round-1',
      p_final_estimate: '5',
      p_note: 'Investigate retries',
    });
  });

  it('normalizes blank Notes to null for both outcome RPCs', async () => {
    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
      error: null,
    } as any);
    const rpc = vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: validSnapshot, error: null } as any);

    await updateRoundOutcome('room-1', 'round-1', '5', '   ');
    await completeRoundAndStartNextRound('room-1', 'round-1', '5', '   ');

    expect(rpc).toHaveBeenNthCalledWith(1, 'update_round_outcome', expect.objectContaining({ p_note: null }));
    expect(rpc).toHaveBeenNthCalledWith(2, 'complete_round_and_start_next_round', expect.objectContaining({ p_note: null }));
  });

  it('counts Unicode Notes by code point and rejects over 240 before the network call', async () => {
    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
      error: null,
    } as any);
    const rpc = vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: validSnapshot, error: null } as any);

    await updateRoundOutcome('room-1', 'round-1', '5', '🎴'.repeat(240));
    expect(rpc).toHaveBeenCalledTimes(1);
    await expect(completeRoundAndStartNextRound('room-1', 'round-1', '5', '🎴'.repeat(241)))
      .rejects.toThrow('Note must be 240 characters or fewer');
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('preserves outcome RPC errors', async () => {
    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
      error: null,
    } as any);
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: null,
      error: { message: 'Host membership required' },
    } as any);

    await expect(updateRoundOutcome('room-1', 'round-1', '5', null)).rejects.toThrow('Host membership required');
  });

  it('renews only the authenticated room member and propagates rejected heartbeats', async () => {
    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } }, error: null,
    } as any);
    const rpc = vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: null, error: null } as any);
    await heartbeatMember('room-1', 'member-1');
    expect(rpc).toHaveBeenCalledExactlyOnceWith('heartbeat_member', { p_room_id: 'room-1', p_member_id: 'member-1' });
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'Presence unavailable' } } as any);
    await expect(heartbeatMember('room-1', 'member-1')).rejects.toThrow('Presence unavailable');
  });
});
