import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
  return {};
});

import { fetchRoomSnapshot, subscribeToRoom } from './roomSync';
import { getSupabaseClient } from './supabase';

const supabase = getSupabaseClient();

const snapshot = {
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
  submittedCount: 1,
  distribution: null,
  recentRounds: [{
    id: 'round-0',
    number: 0,
    status: 'archived',
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

describe('roomSync', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('transitions through connecting and connected, then refreshes on Postgres changes', async () => {
    const onSnapshot = vi.fn();
    const onConnectionChange = vi.fn();
    const onError = vi.fn();
    const handlers: Record<string, Function> = {};

    const channel = {
      on: vi.fn((event: string, filter: any, handler: Function) => {
        handlers[`${event}:${filter.table}`] = handler;
        return channel;
      }),
      subscribe: vi.fn((cb?: (status: string, error?: Error | null) => void) => {
        cb?.('SUBSCRIBED', null);
        return channel;
      }),
      unsubscribe: vi.fn(),
    };

    vi.spyOn(supabase, 'channel').mockReturnValue(channel as any);
    vi.spyOn(supabase.auth, 'getUser').mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null } as any);
    vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: snapshot, error: null } as any);

    const cleanup = subscribeToRoom('room-1', { onSnapshot, onConnectionChange, onError });

    expect(onConnectionChange).toHaveBeenCalledWith('connecting');
    expect(onConnectionChange).toHaveBeenCalledWith('connected');

    expect(channel.on).toHaveBeenCalledWith('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'room_members',
      filter: 'room_id=eq.room-1',
    }, expect.any(Function));
    expect(handlers['postgres_changes:votes']).toBeUndefined();

    const tableHandler = handlers['postgres_changes:room_members'];
    expect(tableHandler).toBeTypeOf('function');
    onSnapshot.mockClear();
    tableHandler();

    await vi.waitFor(() => {
      expect(supabase.rpc).toHaveBeenCalledWith('build_room_snapshot', {
        p_room_id: 'room-1',
        p_user_id: 'user-1',
      });
      expect(onSnapshot).toHaveBeenCalledWith(snapshot);
    });

    cleanup();
  });

  it('reconnects after a channel error and cleans up timers/listeners', () => {
    vi.useFakeTimers();
    const onSnapshot = vi.fn();
    const onConnectionChange = vi.fn();
    const onError = vi.fn();
    const channel = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn((cb?: (status: string, error?: Error | null) => void) => {
        cb?.('CHANNEL_ERROR', new Error('realtime failure'));
        return channel;
      }),
      unsubscribe: vi.fn(),
    };

    vi.spyOn(supabase, 'channel').mockReturnValue(channel as any);
    vi.spyOn(supabase.auth, 'getUser').mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null } as any);
    vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: snapshot, error: null } as any);

    const cleanup = subscribeToRoom('room-1', { onSnapshot, onConnectionChange, onError });

    expect(onConnectionChange).toHaveBeenCalledWith('reconnecting');

    cleanup();
    expect(channel.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('fetches the authoritative room snapshot from the server', async () => {
    vi.spyOn(supabase.auth, 'getUser').mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null } as any);
    vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: snapshot, error: null } as any);

    await expect(fetchRoomSnapshot('room-1')).resolves.toMatchObject({ room: { id: 'room-1' } });
    expect(supabase.rpc).toHaveBeenCalledWith('build_room_snapshot', {
      p_room_id: 'room-1',
      p_user_id: 'user-1',
    });
  });
});
