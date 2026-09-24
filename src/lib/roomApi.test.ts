import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
  return {};
});

import { supabase } from './supabase';
import { createRoom, submitVote } from './roomApi';

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
          },
        ],
        round: {
          id: 'round-1',
          number: 1,
          status: 'voting',
          finalEstimate: null,
          startedAt: '2026-09-24T00:00:00.000Z',
          revealedAt: null,
          archivedAt: null,
        },
        myVote: null,
        submittedCount: 0,
        distribution: null,
        recentRounds: [],
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

  it('rejects malformed cards before any network call', async () => {
    const signIn = vi.spyOn(supabase.auth, 'signInAnonymously');
    const rpc = vi.spyOn(supabase, 'rpc');

    await expect(submitVote('room-1', 'round-1', 'invalid' as any)).rejects.toThrow('Invalid Fibonacci card');
    expect(signIn).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
