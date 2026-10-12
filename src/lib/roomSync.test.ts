import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
  return {};
});

import { fetchRoomSnapshot, subscribeToRoom } from './roomSync';
import { getSupabaseClient } from './supabase';
import * as roomApi from './roomApi';

vi.mock('./roomApi', async () => {
  const actual = await vi.importActual<typeof import('./roomApi')>('./roomApi');
  return { ...actual, heartbeatMember: vi.fn().mockResolvedValue(undefined) };
});

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
  const handlers: Record<string, (message?: { payload: unknown }) => void> = {};
  let subscription!: (status: string, error?: Error) => void;
  const channel = {
    on: vi.fn((_event: string, filter: { table?: string; event?: string }, handler: () => void) => {
      handlers[filter.table ?? filter.event ?? ''] = handler;
      return channel;
    }),
    subscribe: vi.fn((callback: typeof subscription) => {
      subscription = callback;
      return channel;
    }),
    unsubscribe: vi.fn(),
    send: vi.fn().mockResolvedValue('ok'),
  };
  vi.spyOn(supabase, 'channel').mockReturnValue(channel as any);
  vi.spyOn(supabase.auth, 'getUser').mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null } as any);
  const rpc = vi.spyOn(supabase, 'rpc');
  const callbacks = { onSnapshot: vi.fn(), onConnectionChange: vi.fn(), onError: vi.fn(), onVoteAnimation: vi.fn() };
  const roomSubscription = subscribeToRoom('room-1', callbacks, 'member-1');
  return { handlers, subscription, channel, callbacks, roomSubscription, cleanup: roomSubscription.unsubscribe, rpc };
}

describe('roomSync', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.mocked(roomApi.heartbeatMember).mockReset().mockResolvedValue(undefined);
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

    const { unsubscribe: cleanup } = subscribeToRoom('room-1', { onSnapshot, onConnectionChange, onError }, 'member-1');

    expect(onConnectionChange).toHaveBeenCalledWith('connecting');

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
      expect(onConnectionChange).toHaveBeenCalledWith('connected');
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

    const { unsubscribe: cleanup } = subscribeToRoom('room-1', { onSnapshot, onConnectionChange, onError }, 'member-1');

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

  it('broadcasts only value-free vote animation IDs and handles local/echo events once', async () => {
    const harness = syncHarness();
    harness.rpc.mockResolvedValue({ data: snapshot, error: null } as any);
    try {
      harness.subscription('SUBSCRIBED');
      await vi.waitFor(() => expect(harness.callbacks.onSnapshot).toHaveBeenCalled());
      await harness.roomSubscription.sendVoteAnimation('member-1', 'round-1');
      const sent = harness.channel.send.mock.calls[0][0];
      expect(sent.type).toBe('broadcast');
      expect(sent.event).toBe('vote-animation');
      expect(Object.keys(sent.payload).sort()).toEqual(['eventId', 'memberId', 'roundId']);
      expect(sent.payload).toEqual({ eventId: expect.any(String), memberId: 'member-1', roundId: 'round-1' });
      expect(harness.callbacks.onVoteAnimation).toHaveBeenCalledExactlyOnceWith(sent.payload);
      harness.handlers['vote-animation']({ payload: sent.payload });
      expect(harness.callbacks.onVoteAnimation).toHaveBeenCalledTimes(1);
      harness.handlers['vote-animation']({ payload: { ...sent.payload, eventId: 'remote-event' } });
      expect(harness.callbacks.onVoteAnimation).toHaveBeenCalledTimes(2);
      harness.handlers['vote-animation']({ payload: { ...sent.payload, eventId: 'wrong-round', roundId: 'round-old' } });
      harness.handlers['vote-animation']({ payload: { ...sent.payload, eventId: 'unknown-member', memberId: 'stranger' } });
      harness.handlers['vote-animation']({ payload: { ...sent.payload, eventId: 'extra-value', value: '8' } });
      expect(harness.callbacks.onVoteAnimation).toHaveBeenCalledTimes(2);
      harness.cleanup();
      harness.handlers['vote-animation']({ payload: { ...sent.payload, eventId: 'after-disposal' } });
      expect(harness.callbacks.onVoteAnimation).toHaveBeenCalledTimes(2);
    } finally { harness.cleanup(); }
  });

  it('reports animation delivery failures without claiming the persisted vote failed', async () => {
    const harness = syncHarness();
    harness.rpc.mockResolvedValue({ data: snapshot, error: null } as any);
    try {
      harness.subscription('SUBSCRIBED');
      await vi.waitFor(() => expect(harness.callbacks.onSnapshot).toHaveBeenCalled());
      harness.channel.send.mockResolvedValueOnce('timed out');
      await expect(harness.roomSubscription.sendVoteAnimation('member-1', 'round-1')).rejects.toThrow(/Vote saved.*animation/i);
      harness.channel.send.mockRejectedValueOnce(new Error('Transport failure'));
      await expect(harness.roomSubscription.sendVoteAnimation('member-1', 'round-1')).rejects.toThrow(/Vote saved.*animation/i);
      harness.cleanup();
      await expect(harness.roomSubscription.sendVoteAnimation('member-1', 'round-1')).rejects.toThrow(/Vote saved.*animation/i);
    } finally { harness.cleanup(); }
  });

  it('validates an early animation after the initial snapshot arrives, without replaying it', async () => {
    const harness = syncHarness();
    const initial = deferred<any>();
    harness.rpc.mockReturnValueOnce(initial.promise as any).mockResolvedValue({ data: snapshot, error: null } as any);
    try {
      harness.subscription('SUBSCRIBED');
      await vi.waitFor(() => expect(harness.rpc).toHaveBeenCalledTimes(1));
      const event = { memberId: 'member-1', roundId: 'round-1', eventId: 'early-event' };
      harness.handlers['vote-animation']({ payload: event });
      harness.handlers['vote-animation']({ payload: { ...event, eventId: 'unknown', memberId: 'stranger' } });
      expect(harness.callbacks.onVoteAnimation).not.toHaveBeenCalled();
      initial.resolve({ data: snapshot, error: null });
      await vi.waitFor(() => expect(harness.callbacks.onVoteAnimation).toHaveBeenCalledExactlyOnceWith(event));
      harness.handlers.room_members();
      harness.handlers['vote-animation']({ payload: event });
      await vi.waitFor(() => expect(harness.callbacks.onSnapshot).toHaveBeenCalledTimes(2));
      expect(harness.callbacks.onVoteAnimation).toHaveBeenCalledTimes(1);
    } finally { harness.cleanup(); }
  });

  it('retains a new-round animation received before its snapshot refresh starts', async () => {
    const harness = syncHarness();
    harness.rpc.mockResolvedValue({ data: snapshot, error: null } as any);
    try {
      harness.subscription('SUBSCRIBED');
      await vi.waitFor(() => expect(harness.callbacks.onSnapshot).toHaveBeenCalledOnce());
      const event = { memberId: 'member-1', roundId: 'round-2', eventId: 'first-new-round-vote' };
      harness.handlers['vote-animation']({ payload: event });
      expect(harness.callbacks.onVoteAnimation).not.toHaveBeenCalled();
      harness.rpc.mockResolvedValue({ data: { ...snapshot, round: { ...snapshot.round, id: 'round-2', number: 2 } }, error: null } as any);
      harness.handlers.rounds();
      await vi.waitFor(() => expect(harness.callbacks.onSnapshot).toHaveBeenCalledTimes(2));
      expect(harness.callbacks.onVoteAnimation).toHaveBeenCalledExactlyOnceWith(event);
    } finally { harness.cleanup(); }
  });

  it('renews presence on subscription and every 30 seconds, never on ordinary room events', async () => {
    vi.useFakeTimers();
    const harness = syncHarness();
    harness.rpc.mockResolvedValue({ data: snapshot, error: null } as any);
    try {
      harness.subscription('SUBSCRIBED');
      await vi.advanceTimersByTimeAsync(0);
      expect(roomApi.heartbeatMember).toHaveBeenCalledExactlyOnceWith('room-1', 'member-1');
      harness.handlers.room_members();
      harness.handlers.rounds();
      await vi.advanceTimersByTimeAsync(0);
      expect(roomApi.heartbeatMember).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(95_000);
      expect(roomApi.heartbeatMember).toHaveBeenCalledTimes(4);
      harness.cleanup();
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(60_000);
      expect(roomApi.heartbeatMember).toHaveBeenCalledTimes(4);
      expect(vi.getTimerCount()).toBe(0);
    } finally { harness.cleanup(); }
  });

  it.each(['focus', 'online', 'pageshow', 'visibilitychange'])('renews presence immediately on %s', async (event) => {
    const harness = syncHarness();
    harness.rpc.mockResolvedValue({ data: snapshot, error: null } as any);
    try {
      harness.subscription('SUBSCRIBED');
      await vi.waitFor(() => expect(harness.callbacks.onSnapshot).toHaveBeenCalled());
      vi.mocked(roomApi.heartbeatMember).mockClear();
      (event === 'visibilitychange' ? document : window).dispatchEvent(new Event(event));
      await vi.waitFor(() => expect(roomApi.heartbeatMember).toHaveBeenCalledExactlyOnceWith('room-1', 'member-1'));
    } finally { harness.cleanup(); }
  });

  it('reports heartbeat failure, does not claim connection on a snapshot-only refresh, and recovers on focus', async () => {
    const harness = syncHarness();
    harness.rpc.mockResolvedValue({ data: snapshot, error: null } as any);
    vi.mocked(roomApi.heartbeatMember).mockRejectedValueOnce(new Error('Presence unavailable'));
    try {
      harness.subscription('SUBSCRIBED');
      await vi.waitFor(() => expect(harness.callbacks.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Presence unavailable' })));
      expect(harness.callbacks.onConnectionChange).not.toHaveBeenCalledWith('connected');
      harness.callbacks.onConnectionChange.mockClear();
      harness.handlers.room_members();
      await vi.waitFor(() => expect(harness.callbacks.onSnapshot).toHaveBeenCalled());
      expect(harness.callbacks.onConnectionChange).not.toHaveBeenCalledWith('connected');
      window.dispatchEvent(new Event('focus'));
      await vi.waitFor(() => expect(harness.callbacks.onConnectionChange).toHaveBeenCalledWith('connected'));
    } finally { harness.cleanup(); }
  });

  it('coalesces concurrent resume signals and ignores a disposed in-flight heartbeat', async () => {
    const harness = syncHarness();
    harness.rpc.mockResolvedValue({ data: snapshot, error: null } as any);
    const pending = deferred<void>();
    vi.mocked(roomApi.heartbeatMember).mockReturnValueOnce(pending.promise);
    harness.subscription('SUBSCRIBED');
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(roomApi.heartbeatMember).toHaveBeenCalledOnce());
    harness.cleanup();
    pending.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.callbacks.onSnapshot).not.toHaveBeenCalled();
    expect(harness.callbacks.onConnectionChange).not.toHaveBeenCalledWith('connected');
    expect(harness.rpc).not.toHaveBeenCalled();
  });

  it('reconnects a closed channel and cancels the backoff when the network returns', async () => {
    vi.useFakeTimers();
    const harness = syncHarness();
    const replacement = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis(), unsubscribe: vi.fn() };
    vi.mocked(supabase.channel).mockReturnValueOnce(replacement as any);
    try {
      harness.subscription('CLOSED');
      expect(harness.callbacks.onConnectionChange).toHaveBeenCalledWith('reconnecting');
      expect(vi.getTimerCount()).toBe(1);
      window.dispatchEvent(new Event('online'));
      expect(replacement.subscribe).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally { harness.cleanup(); }
  });

  it('does not let an in-flight heartbeat restore an offline connection', async () => {
    vi.useFakeTimers();
    const harness = syncHarness();
    const pending = deferred<void>();
    vi.mocked(roomApi.heartbeatMember).mockReturnValueOnce(pending.promise);
    harness.rpc.mockResolvedValue({ data: snapshot, error: null } as any);
    try {
      harness.subscription('SUBSCRIBED');
      window.dispatchEvent(new Event('offline'));
      pending.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(harness.callbacks.onConnectionChange).toHaveBeenLastCalledWith('reconnecting');
      expect(harness.callbacks.onSnapshot).not.toHaveBeenCalled();
      window.dispatchEvent(new Event('focus'));
      await vi.advanceTimersByTimeAsync(60_000);
      expect(roomApi.heartbeatMember).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
      const replacement = {
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn((_callback: (status: string) => void) => replacement),
        unsubscribe: vi.fn(),
      };
      vi.mocked(supabase.channel).mockReturnValueOnce(replacement as any);
      window.dispatchEvent(new Event('online'));
      replacement.subscribe.mock.calls[0][0]('SUBSCRIBED');
      await vi.advanceTimersByTimeAsync(0);
      expect(harness.callbacks.onSnapshot).toHaveBeenCalledExactlyOnceWith(snapshot);
      expect(harness.callbacks.onConnectionChange).toHaveBeenLastCalledWith('connected');
      expect(roomApi.heartbeatMember).toHaveBeenCalledTimes(2);
    } finally { harness.cleanup(); }
  });

  it('requires a fresh heartbeat after replacing a channel with a pending renewal', async () => {
    vi.useFakeTimers();
    const harness = syncHarness();
    const oldRenewal = deferred<void>();
    const newRenewal = deferred<void>();
    vi.mocked(roomApi.heartbeatMember).mockReturnValueOnce(oldRenewal.promise).mockReturnValueOnce(newRenewal.promise);
    harness.rpc.mockResolvedValue({ data: snapshot, error: null } as any);
    const replacement = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn((_callback: (status: string) => void) => replacement),
      unsubscribe: vi.fn(),
    };
    vi.mocked(supabase.channel).mockReturnValueOnce(replacement as any);
    try {
      harness.subscription('SUBSCRIBED');
      harness.subscription('CLOSED');
      window.dispatchEvent(new Event('online'));
      replacement.subscribe.mock.calls[0][0]('SUBSCRIBED');
      oldRenewal.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(harness.callbacks.onSnapshot).not.toHaveBeenCalled();
      expect(harness.callbacks.onConnectionChange).not.toHaveBeenCalledWith('connected');
      expect(roomApi.heartbeatMember).toHaveBeenCalledTimes(2);
      newRenewal.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(harness.callbacks.onSnapshot).toHaveBeenCalledExactlyOnceWith(snapshot);
      expect(harness.callbacks.onConnectionChange).toHaveBeenLastCalledWith('connected');
    } finally { harness.cleanup(); }
  });

  it.each(['resolve', 'reject'] as const)('ignores a replaced channel snapshot that later %ss', async (result) => {
    vi.useFakeTimers();
    const harness = syncHarness();
    const pending = deferred<{ data: typeof snapshot; error: null }>();
    harness.rpc.mockReturnValueOnce(pending.promise as any).mockResolvedValue({ data: snapshot, error: null } as any);
    const replacement = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn((_callback: (status: string) => void) => replacement),
      unsubscribe: vi.fn(),
    };
    vi.mocked(supabase.channel).mockReturnValueOnce(replacement as any);
    try {
      harness.subscription('SUBSCRIBED');
      await vi.advanceTimersByTimeAsync(0);
      harness.subscription('CLOSED');
      window.dispatchEvent(new Event('online'));
      replacement.subscribe.mock.calls[0][0]('SUBSCRIBED');
      if (result === 'resolve') {
        pending.resolve({ data: { ...snapshot, room: { ...snapshot.room, name: 'Stale room' } }, error: null });
      } else {
        pending.reject(new Error('Old connection failed'));
      }
      await vi.advanceTimersByTimeAsync(0);
      expect(harness.callbacks.onError).not.toHaveBeenCalled();
      expect(harness.callbacks.onSnapshot).toHaveBeenCalledExactlyOnceWith(snapshot);
      expect(harness.callbacks.onConnectionChange).toHaveBeenLastCalledWith('connected');
    } finally { harness.cleanup(); }
  });
});
