import type { RoomSnapshot } from '../../lib/roomApi';

export type RecentRoomMeta = {
  roomId: string;
  code: string;
  nickname: string;
  memberId: string;
  roomName: string;
  lastJoinedAt: string;
};

export const RECENT_ROOMS_KEY = 'poker.recentRooms';

export function readRecentRooms(): RecentRoomMeta[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(RECENT_ROOMS_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((entry): entry is RecentRoomMeta => {
      return typeof entry === 'object' && entry !== null
        && 'roomId' in entry && typeof (entry as { roomId?: unknown }).roomId === 'string'
        && Boolean((entry as { roomId: string }).roomId)
        && 'code' in entry && typeof (entry as { code?: unknown }).code === 'string'
        && 'nickname' in entry && typeof (entry as { nickname?: unknown }).nickname === 'string'
        && 'memberId' in entry && typeof (entry as { memberId?: unknown }).memberId === 'string';
    });
  } catch {
    return [];
  }
}

export function writeRecentRooms(recentRooms: RecentRoomMeta[]): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(RECENT_ROOMS_KEY, JSON.stringify(recentRooms));
}

export function saveRecentRoom(snapshot: RoomSnapshot): void {
  const member = snapshot.members.find((entry) => entry.id === snapshot.myMemberId);
  const entry: RecentRoomMeta = {
    roomId: snapshot.room.id,
    code: snapshot.room.code,
    nickname: member?.nickname ?? 'Guest',
    memberId: snapshot.myMemberId,
    roomName: snapshot.room.name,
    lastJoinedAt: new Date().toISOString(),
  };

  const recentRooms = readRecentRooms().filter((room) => room.code !== snapshot.room.code);
  writeRecentRooms([entry, ...recentRooms].slice(0, 5));
}

export function getShareLink(code: string): string {
  if (typeof window === 'undefined') {
    return `/room/${code}`;
  }

  return `${window.location.origin}/room/${code}`;
}

export async function copyShareLink(code: string): Promise<string> {
  const link = getShareLink(code);
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    await navigator.clipboard.writeText(link);
  }
  return link;
}
