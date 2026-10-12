import type { RoomSnapshot } from './roomApi';
import { fetchRoomSnapshot as fetchSnapshotApi, heartbeatMember } from './roomApi';
import { getSupabaseClient } from './supabase';

export type RoomSyncCallbacks = {
  onSnapshot(snapshot: RoomSnapshot): void;
  onConnectionChange(status: 'connecting' | 'connected' | 'reconnecting' | 'error'): void;
  onError(error: Error): void;
  onVoteAnimation?(event: VoteAnimationEvent): void;
};

export type VoteAnimationEvent = {
  memberId: string;
  roundId: string;
  eventId: string;
};

export type RoomSubscription = {
  unsubscribe(): void;
  sendVoteAnimation(memberId: string, roundId: string): Promise<void>;
};

const RETRY_DELAYS = [500, 1000, 2000, 5000];

export async function fetchRoomSnapshot(roomId: string): Promise<RoomSnapshot> {
  return fetchSnapshotApi(roomId);
}

export function subscribeToRoom(roomId: string, callbacks: RoomSyncCallbacks, memberId: string): RoomSubscription {
  const supabase = getSupabaseClient();
  let isCancelled = false;
  let retryIndex = 0;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let channel: ReturnType<typeof supabase.channel> | null = null;
  let refreshPending = false;
  let presencePending = false;
  let renewingPresence = false;
  let presenceHealthy = false;
  let refreshing = false;
  let connected = false;
  let networkAvailable = navigator.onLine;
  let connectionGeneration = 0;
  let refreshGeneration = 0;
  let latestSnapshot: RoomSnapshot | null = null;
  const seenAnimations = new Set<string>();
  const pendingAnimations = new Map<string, VoteAnimationEvent>();

  const receiveVoteAnimation = (payload: unknown) => {
    if (isCancelled || !payload || typeof payload !== 'object' || Array.isArray(payload)) return;
    if (Object.keys(payload).length !== 3) return;
    if (!('memberId' in payload) || !('roundId' in payload) || !('eventId' in payload)) return;
    const { memberId, roundId, eventId } = payload;
    if (typeof memberId !== 'string' || !memberId || memberId.length > 128
      || typeof roundId !== 'string' || !roundId || roundId.length > 128
      || typeof eventId !== 'string' || !eventId || eventId.length > 128) return;
    if (seenAnimations.has(eventId)) return;
    if (!latestSnapshot || latestSnapshot.round.id !== roundId) {
      pendingAnimations.set(eventId, { memberId, roundId, eventId });
      if (pendingAnimations.size > 64) {
        const oldest = pendingAnimations.keys().next().value;
        if (oldest !== undefined) pendingAnimations.delete(oldest);
      }
      return;
    }
    if (latestSnapshot.round.status !== 'voting' || latestSnapshot.round.id !== roundId
      || !latestSnapshot.members.some((member) => member.id === memberId && member.role !== 'observer')) return;
    seenAnimations.add(eventId);
    if (seenAnimations.size > 256) {
      const oldest = seenAnimations.values().next().value;
      if (oldest !== undefined) seenAnimations.delete(oldest);
    }
    callbacks.onVoteAnimation?.({ memberId, roundId, eventId });
  };

  const stopHeartBeat = () => {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };

  const refreshSnapshot = async (renewPresence = false) => {
    if (isCancelled || !networkAvailable) {
      return;
    }
    refreshPending = true;
    if (renewPresence && (!renewingPresence || refreshGeneration !== connectionGeneration)) presencePending = true;
    if (refreshing) {
      return;
    }
    refreshing = true;
    try {
      while (refreshPending && !isCancelled && networkAvailable) {
        refreshPending = false;
        const generation = connectionGeneration;
        refreshGeneration = generation;
        renewingPresence = presencePending;
        presencePending = false;
        try {
          if (renewingPresence) {
            await heartbeatMember(roomId, memberId);
            if (isCancelled) return;
            if (generation !== connectionGeneration) continue;
            presenceHealthy = true;
          }
          const snapshot = await fetchSnapshotApi(roomId);
          if (!isCancelled && generation === connectionGeneration && !refreshPending) {
            latestSnapshot = snapshot;
            callbacks.onSnapshot(snapshot);
            if (connected && presenceHealthy) callbacks.onConnectionChange('connected');
            const pending = [...pendingAnimations.values()];
            pendingAnimations.clear();
            for (const event of pending) {
              if (event.roundId === snapshot.round.id) receiveVoteAnimation(event);
            }
          }
        } catch (error) {
          if (!isCancelled && generation === connectionGeneration) {
            presenceHealthy = false;
            callbacks.onError(error instanceof Error ? error : new Error(String(error)));
            callbacks.onConnectionChange('error');
          }
        } finally {
          renewingPresence = false;
        }
      }
    } finally {
      refreshing = false;
    }
  };

  const cleanup = () => {
    if (isCancelled) return;
    isCancelled = true;
    connected = false;
    refreshPending = false;
    presencePending = false;
    pendingAnimations.clear();
    seenAnimations.clear();
    retryIndex = RETRY_DELAYS.length;
    stopHeartBeat();
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    if (channel) {
      channel.unsubscribe();
      channel = null;
    }
    window.removeEventListener('focus', resume);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('pageshow', resume);
    window.removeEventListener('offline', onOffline);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };

  const startHeartbeat = () => {
    stopHeartBeat();
    heartbeat = setInterval(() => {
      if (!isCancelled) {
        void refreshSnapshot(true);
      }
    }, 30000);
  };

  const connect = () => {
    if (isCancelled || !networkAvailable) {
      return;
    }

    connectionGeneration += 1;
    refreshPending = false;
    presencePending = false;
    stopHeartBeat();
    callbacks.onConnectionChange('connecting');
    connected = false;
    presenceHealthy = false;
    channel?.unsubscribe();
    const nextChannel = supabase.channel(`room-${roomId}`, { config: { broadcast: { ack: true } } });
    channel = nextChannel;

    const onRoomChange = () => {
      if (channel === nextChannel) {
        void refreshSnapshot();
      }
    };

    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, onRoomChange);
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'room_members', filter: `room_id=eq.${roomId}` }, onRoomChange);
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'rounds', filter: `room_id=eq.${roomId}` }, onRoomChange);
    channel.on('broadcast', { event: 'vote-animation' }, ({ payload }: { payload: unknown }) => {
      if (channel === nextChannel) receiveVoteAnimation(payload);
    });

    channel.subscribe((status, error) => {
      if (isCancelled || !networkAvailable || channel !== nextChannel) {
        return;
      }

      if (status === 'SUBSCRIBED') {
        connected = true;
        retryIndex = 0;
        if (retryTimer) {
          clearTimeout(retryTimer);
          retryTimer = null;
        }
        startHeartbeat();
        void refreshSnapshot(true);
        return;
      }

      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        connectionGeneration += 1;
        refreshPending = false;
        presencePending = false;
        connected = false;
        presenceHealthy = false;
        stopHeartBeat();
        callbacks.onConnectionChange('reconnecting');
        if (error) {
          callbacks.onError(error instanceof Error ? error : new Error(String(error)));
        }

        const delay = RETRY_DELAYS[Math.min(retryIndex, RETRY_DELAYS.length - 1)];
        retryIndex = Math.min(retryIndex + 1, RETRY_DELAYS.length - 1);

        if (retryTimer) {
          return;
        }
        retryTimer = setTimeout(() => {
          retryTimer = null;
          if (!isCancelled) {
            connect();
          }
        }, delay);
      }
    });
  };

  const resume = () => {
    if (isCancelled || !networkAvailable) return;
    if (connected) {
      void refreshSnapshot(true);
    } else {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      connect();
    }
  };
  const onOnline = () => {
    networkAvailable = true;
    resume();
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') resume();
  };
  const onOffline = () => {
    if (isCancelled) return;
    networkAvailable = false;
    connectionGeneration += 1;
    connected = false;
    presenceHealthy = false;
    refreshPending = false;
    presencePending = false;
    stopHeartBeat();
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    callbacks.onConnectionChange('reconnecting');
  };
  window.addEventListener('focus', resume);
  window.addEventListener('online', onOnline);
  window.addEventListener('pageshow', resume);
  window.addEventListener('offline', onOffline);
  document.addEventListener('visibilitychange', onVisibilityChange);

  connect();
  return {
    unsubscribe: cleanup,
    async sendVoteAnimation(memberId, roundId) {
      const deliveryError = 'Vote saved, but the member animation could not be synchronized.';
      if (isCancelled || !connected || !channel) throw new Error(deliveryError);
      const event: VoteAnimationEvent = { memberId, roundId, eventId: crypto.randomUUID() };
      receiveVoteAnimation(event);
      let result: string;
      try {
        result = await channel.send({ type: 'broadcast', event: 'vote-animation', payload: event });
      } catch (caughtError) {
        throw new Error(`${deliveryError} ${caughtError instanceof Error ? caughtError.message : String(caughtError)}`);
      }
      if (result !== 'ok') throw new Error(deliveryError);
    },
  };
}
