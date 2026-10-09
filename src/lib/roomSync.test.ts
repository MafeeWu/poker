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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function syncHarness() {
  const handlers: Record<string, () => void> = {};
  let subscription!: (status: string, error?: Error) => void;
  const channel = {
    on: vi.fn((_event: string, filter: { table: string }, handler: () => void) => {
      handlers[filter.table] = handler;
      return channel;
    }),
    subscribe: vi.fn((callback: typeof subscription) => {
      subscription = callback;
      return channel;
    }),
    unsubscribe: vi.fn(),
  };
  vi.spyOn(supabase, 'channel').mockReturnValue(channel as any);
  vi.spyOn(supabase.auth, 'getUser').mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null } as any);
  const rpc = vi.spyOn(supabase, 'rpc');
  const callbacks = { onSnapshot: vi.fn(), onConnectionChange: vi.fn(), onError: vi.fn() };
  const cleanup = subscribeToRoom('room-1', callbacks);
  return { handlers, subscription, channel, callbacks, cleanup, rpc };
}

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

  it('coalesces events during a deferred fetch and never applies its obsolete snapshot', async () => {
    const harness = syncHarness();
    const older = deferred<any>();
    const newer = deferred<any>();
    harness.rpc.mockReturnValueOnce(older.promise as any).mockReturnValueOnce(newer.promise as any);
    try {
      harness.subscription('SUBSCRIBED');
      await vi.waitFor(() => expect(harness.rpc).toHaveBeenCalledTimes(1));
      harness.handlers.room_members();
      harness.handlers.rounds();
      harness.handlers.rooms();
      await Promise.resolve();
      expect(harness.rpc).toHaveBeenCalledTimes(1);

      older.resolve({ data: snapshot, error: null });
      await vi.waitFor(() => expect(harness.rpc).toHaveBeenCalledTimes(2));
      expect(harness.callbacks.onSnapshot).not.toHaveBeenCalled();
      const latest = {
        ...snapshot,
        room: { ...snapshot.room, hostMemberId: 'member-2' },
        round: { ...snapshot.round, id: 'round-2', number: 2 },
        members: [
          { ...snapshot.members[0], role: 'voter', hasVoted: true },
          { ...snapshot.members[0], id: 'member-2', nickname: 'Bob', role: 'host' },
        ],
      };
      newer.resolve({ data: latest, error: null });
      await vi.waitFor(() => expect(harness.callbacks.onSnapshot).toHaveBeenCalledExactlyOnceWith(latest));
      expect(harness.handlers.votes).toBeUndefined();
    } finally { harness.cleanup(); }
  });

  it('reports an in-flight fetch error and still fetches pending changes', async () => {
    const harness = syncHarness();
    const failed = deferred<any>();
    harness.rpc.mockReturnValueOnce(failed.promise as any).mockResolvedValueOnce({ data: snapshot, error: null } as any);
    try {
      harness.subscription('SUBSCRIBED');
      await vi.waitFor(() => expect(harness.rpc).toHaveBeenCalledTimes(1));
      harness.handlers.room_members();
      failed.reject(new Error('Snapshot unavailable'));
      await vi.waitFor(() => expect(harness.callbacks.onSnapshot).toHaveBeenCalledWith(snapshot));
      expect(harness.callbacks.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Snapshot unavailable' }));
      expect(harness.callbacks.onConnectionChange).toHaveBeenCalledWith('error');
      expect(harness.rpc).toHaveBeenCalledTimes(2);
    } finally { harness.cleanup(); }
  });

  it.each(['resolve', 'reject'] as const)('ignores a disposed in-flight %s and does not fetch queued events', async (result) => {
    const harness = syncHarness();
    const pending = deferred<any>();
    harness.rpc.mockReturnValueOnce(pending.promise as any);
    harness.subscription('SUBSCRIBED');
    await vi.waitFor(() => expect(harness.rpc).toHaveBeenCalledTimes(1));
    harness.handlers.rounds();
    harness.cleanup();
    harness.callbacks.onConnectionChange.mockClear();
    if (result === 'resolve') pending.resolve({ data: snapshot, error: null });
    else pending.reject(new Error('Late failure'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    harness.handlers.room_members();
    harness.subscription('SUBSCRIBED');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.callbacks.onSnapshot).not.toHaveBeenCalled();
    expect(harness.callbacks.onError).not.toHaveBeenCalled();
    expect(harness.callbacks.onConnectionChange).not.toHaveBeenCalled();
    expect(harness.rpc).toHaveBeenCalledTimes(1);
    expect(harness.channel.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('recovers from a fetch error on the heartbeat and cancels all timers on disposal', async () => {
    vi.useFakeTimers();
    const harness = syncHarness();
    harness.rpc.mockRejectedValueOnce(new Error('Temporary fetch failure'))
      .mockResolvedValueOnce({ data: snapshot, error: null } as any);
    harness.subscription('SUBSCRIBED');
    await vi.waitFor(() => expect(harness.callbacks.onError).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(30_000);
    expect(harness.callbacks.onSnapshot).toHaveBeenCalledWith(snapshot);
    harness.cleanup();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(harness.rpc).toHaveBeenCalledTimes(2);
  });

  it('unsubscribes the old channel on retry and ignores its callbacks after replacement', async () => {
    vi.useFakeTimers();
    const harness = syncHarness();
    const replacement = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis(), unsubscribe: vi.fn() };
    vi.mocked(supabase.channel).mockReturnValueOnce(replacement as any);
    harness.subscription('CHANNEL_ERROR', new Error('Channel failure'));
    harness.subscription('TIMED_OUT');
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(harness.channel.unsubscribe).toHaveBeenCalledTimes(1);
    harness.callbacks.onConnectionChange.mockClear();
    harness.subscription('SUBSCRIBED');
    harness.handlers.rounds();
    await Promise.resolve();
    expect(harness.callbacks.onConnectionChange).not.toHaveBeenCalled();
    expect(harness.rpc).not.toHaveBeenCalled();
    harness.cleanup();
    expect(replacement.unsubscribe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
