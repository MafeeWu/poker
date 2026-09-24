import { FIBONACCI_CARDS, type VoteDistribution, type VoteValue } from '../domain/poker';
import type { Database, RoomSnapshotJson } from './database.types';
import { supabase } from './supabase';

export type JoinRole = 'voter' | 'observer';

export type RoomRecord = {
  id: string;
  code: string;
  name: string;
  hostMemberId: string;
  maxMembers: number;
  createdAt: string;
};

export type MemberRecord = {
  id: string;
  nickname: string;
  role: 'host' | 'voter' | 'observer';
  joinedAt: string;
  lastSeenAt: string;
  online: boolean;
};

export type RoundRecord = {
  id: string;
  number: number;
  status: 'voting' | 'revealed' | 'archived';
  finalEstimate: string | null;
  startedAt: string;
  revealedAt: string | null;
  archivedAt: string | null;
};

export type ArchivedRoundRecord = RoundRecord & {
  distribution: VoteDistribution;
};

export type RoomSnapshot = {
  room: RoomRecord;
  myMemberId: string;
  members: MemberRecord[];
  round: RoundRecord;
  myVote: VoteValue | null;
  submittedCount: number;
  distribution: VoteDistribution | null;
  recentRounds: ArchivedRoundRecord[];
};

function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return new Error(error.message);
  }

  return new Error('Unexpected Supabase error');
}

function normalizeText(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required`);
  }
  return trimmed;
}

function normalizeMember(record: MemberRecord): MemberRecord {
  return {
    id: record.id,
    nickname: record.nickname,
    role: record.role,
    joinedAt: record.joinedAt,
    lastSeenAt: record.lastSeenAt,
    online: Boolean(record.online),
  };
}

function normalizeRound(record: RoundRecord): RoundRecord {
  return {
    id: record.id,
    number: record.number,
    status: record.status,
    finalEstimate: record.finalEstimate,
    startedAt: record.startedAt,
    revealedAt: record.revealedAt,
    archivedAt: record.archivedAt,
  };
}

function normalizeArchivedRound(record: ArchivedRoundRecord): ArchivedRoundRecord {
  return {
    ...normalizeRound(record),
    distribution: { ...(record.distribution ?? {}) },
  };
}

export function normalizeRoomSnapshot(snapshot: Partial<RoomSnapshotJson> | Partial<RoomSnapshot> | null | undefined): RoomSnapshot {
  const room = snapshot?.room as Partial<RoomRecord> | undefined;
  const members = Array.isArray(snapshot?.members) ? snapshot.members.map((member) => normalizeMember(member as MemberRecord)) : [];
  const round = snapshot?.round as Partial<RoundRecord> | undefined;
  const recentRounds = Array.isArray((snapshot as any)?.recentRounds)
    ? (snapshot as any).recentRounds.map((entry: ArchivedRoundRecord) => normalizeArchivedRound(entry))
    : [];

  const normalizedRoom: RoomRecord = {
    id: room?.id ?? '',
    code: room?.code ?? '',
    name: room?.name ?? '',
    hostMemberId: room?.hostMemberId ?? '',
    maxMembers: Number(room?.maxMembers ?? 0),
    createdAt: room?.createdAt ?? new Date(0).toISOString(),
  };

  const normalizedRound: RoundRecord = {
    id: round?.id ?? '',
    number: Number(round?.number ?? 0),
    status: round?.status ?? 'voting',
    finalEstimate: round?.finalEstimate ?? null,
    startedAt: round?.startedAt ?? new Date(0).toISOString(),
    revealedAt: round?.revealedAt ?? null,
    archivedAt: round?.archivedAt ?? null,
  };

  const myMemberId = typeof (snapshot as any)?.myMemberId === 'string' ? (snapshot as any).myMemberId : members[0]?.id ?? '';
  const submittedCount = typeof (snapshot as any)?.submittedCount === 'number' ? (snapshot as any).submittedCount : members.length;
  const myVote = (snapshot as any)?.myVote ?? null;
  const distribution = (snapshot as any)?.distribution ?? null;

  return {
    room: normalizedRoom,
    myMemberId,
    members,
    round: normalizedRound,
    myVote: myVote as VoteValue | null,
    submittedCount,
    distribution: distribution && typeof distribution === 'object' ? { ...(distribution as VoteDistribution) } : null,
    recentRounds,
  };
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name as keyof Database['public']['Functions'], args as never);
  if (error) {
    throw toError(error);
  }
  return data as T;
}

export async function ensureAnonymousSession(): Promise<void> {
  const { error } = await supabase.auth.signInAnonymously();
  if (error) {
    throw toError(error);
  }
}

export async function createRoom(name: string, nickname: string): Promise<RoomSnapshot> {
  const trimmedName = normalizeText(name, 'Room name');
  const trimmedNickname = normalizeText(nickname, 'Nickname');

  await ensureAnonymousSession();
  const response = await rpc<RoomSnapshotJson>('create_room', {
    p_name: trimmedName,
    p_nickname: trimmedNickname,
  });

  return normalizeRoomSnapshot(response);
}

export async function joinRoom(code: string, nickname: string, role: JoinRole): Promise<RoomSnapshot> {
  const trimmedCode = normalizeText(code, 'Room code');
  const trimmedNickname = normalizeText(nickname, 'Nickname');
  const normalizedRole: JoinRole = role === 'observer' ? 'observer' : 'voter';

  await ensureAnonymousSession();
  const response = await rpc<RoomSnapshotJson>('join_room', {
    p_code: trimmedCode,
    p_nickname: trimmedNickname,
    p_role: normalizedRole,
  });

  return normalizeRoomSnapshot(response);
}

export async function submitVote(roomId: string, roundId: string, value: VoteValue): Promise<RoomSnapshot> {
  if (!FIBONACCI_CARDS.includes(value)) {
    throw new Error('Invalid Fibonacci card');
  }

  await ensureAnonymousSession();
  const response = await rpc<RoomSnapshotJson>('submit_vote', {
    p_room_id: roomId,
    p_round_id: roundId,
    p_value: value,
  });

  return normalizeRoomSnapshot(response);
}

export async function revealRound(roomId: string, roundId: string): Promise<RoomSnapshot> {
  await ensureAnonymousSession();
  const response = await rpc<RoomSnapshotJson>('reveal_round', {
    p_room_id: roomId,
    p_round_id: roundId,
  });

  return normalizeRoomSnapshot(response);
}

export async function archiveRound(roomId: string, roundId: string, finalEstimate: string): Promise<RoomSnapshot> {
  const trimmedEstimate = finalEstimate.trim();
  if (!trimmedEstimate) {
    throw new Error('Final estimate is required');
  }

  await ensureAnonymousSession();
  const response = await rpc<RoomSnapshotJson>('archive_round', {
    p_room_id: roomId,
    p_round_id: roundId,
    p_final_estimate: trimmedEstimate,
  });

  return normalizeRoomSnapshot(response);
}

export async function startNextRound(roomId: string, roundId: string): Promise<RoomSnapshot> {
  await ensureAnonymousSession();
  const response = await rpc<RoomSnapshotJson>('start_next_round', {
    p_room_id: roomId,
    p_round_id: roundId,
  });

  return normalizeRoomSnapshot(response);
}

export async function transferHost(roomId: string, memberId: string): Promise<RoomSnapshot> {
  await ensureAnonymousSession();
  const response = await rpc<RoomSnapshotJson>('transfer_host', {
    p_room_id: roomId,
    p_member_id: memberId,
  });

  return normalizeRoomSnapshot(response);
}

export async function fetchRoomSnapshot(roomId: string): Promise<RoomSnapshot> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id ?? '';

  if (!userId) {
    await ensureAnonymousSession();
  }

  const { data: refreshedUserData } = await supabase.auth.getUser();
  const resolvedUserId = refreshedUserData?.user?.id ?? userId;

  const response = await rpc<RoomSnapshotJson>('build_room_snapshot', {
    p_room_id: roomId,
    p_user_id: resolvedUserId,
  });

  return normalizeRoomSnapshot(response);
}
