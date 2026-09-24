import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
  return {};
});

import { fetchRoomSnapshot, subscribeToRoom } from './roomSync';
import { supabase } from './supabase';

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
  submittedCount: 1,
  distribution: null,
  recentRounds: [],
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

    const tableHandler = handlers['postgres_changes:rooms'];
    expect(tableHandler).toBeTypeOf('function');
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
