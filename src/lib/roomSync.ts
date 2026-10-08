import type { RoomSnapshot } from './roomApi';
import { fetchRoomSnapshot as fetchSnapshotApi } from './roomApi';
import { getSupabaseClient } from './supabase';

export type RoomSyncCallbacks = {
  onSnapshot(snapshot: RoomSnapshot): void;
  onConnectionChange(status: 'connecting' | 'connected' | 'reconnecting' | 'error'): void;
  onError(error: Error): void;
};

const RETRY_DELAYS = [500, 1000, 2000, 5000];

export async function fetchRoomSnapshot(roomId: string): Promise<RoomSnapshot> {
  return fetchSnapshotApi(roomId);
}

export function subscribeToRoom(roomId: string, callbacks: RoomSyncCallbacks): () => void {
  const supabase = getSupabaseClient();
  let isCancelled = false;
  let retryIndex = 0;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let channel: ReturnType<typeof supabase.channel> | null = null;

  const stopHeartBeat = () => {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };

  const refreshSnapshot = async () => {
    try {
      const snapshot = await fetchSnapshotApi(roomId);
      callbacks.onSnapshot(snapshot);
    } catch (error) {
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
      callbacks.onConnectionChange('error');
    }
  };

  const cleanup = () => {
    isCancelled = true;
    retryIndex = RETRY_DELAYS.length;
    stopHeartBeat();
    if (channel) {
      channel.unsubscribe();
      channel = null;
    }
  };

  const startHeartbeat = () => {
    stopHeartBeat();
    heartbeat = setInterval(() => {
      if (!isCancelled) {
        void refreshSnapshot();
      }
    }, 30000);
  };

  const connect = () => {
    if (isCancelled) {
      return;
    }

    callbacks.onConnectionChange('connecting');
    channel = supabase.channel(`room-${roomId}`);

    const onRoomChange = () => {
      void refreshSnapshot();
    };

    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, onRoomChange);
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'room_members', filter: `room_id=eq.${roomId}` }, onRoomChange);
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'rounds', filter: `room_id=eq.${roomId}` }, onRoomChange);

    channel.subscribe((status, error) => {
      if (isCancelled) {
        return;
      }

      if (status === 'SUBSCRIBED') {
        callbacks.onConnectionChange('connected');
        startHeartbeat();
        void refreshSnapshot();
        return;
      }

      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        callbacks.onConnectionChange('reconnecting');
        if (error) {
          callbacks.onError(error instanceof Error ? error : new Error(String(error)));
        }

        const delay = RETRY_DELAYS[Math.min(retryIndex, RETRY_DELAYS.length - 1)];
        retryIndex = Math.min(retryIndex + 1, RETRY_DELAYS.length - 1);

        setTimeout(() => {
          if (!isCancelled) {
            connect();
          }
        }, delay);
      }
    });
  };

  connect();
  return cleanup;
}
