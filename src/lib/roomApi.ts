import { FIBONACCI_CARDS, type VoteDistribution, type VoteValue } from '../domain/poker';
import type { Database, RoomSnapshotJson } from './database.types';
import { getSupabaseClient } from './supabase';

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Invalid snapshot field: ${field}`);
  }
  return value;
}

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid snapshot field: ${field}`);
  }
  return value;
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid snapshot field: ${field}`);
  }
  return value;
}

function nullableString(value: unknown, field: string): string | null {
  if (value !== null && typeof value !== 'string') {
    throw new Error(`Invalid snapshot field: ${field}`);
  }
  return value;
}

function validateDistribution(value: unknown, field: string): VoteDistribution {
  if (!isRecord(value)) {
    throw new Error(`Invalid snapshot field: ${field}`);
  }

  const distribution = {} as VoteDistribution;
  for (const card of FIBONACCI_CARDS) {
    distribution[card] = requiredNumber(value[card], `${field}.${card}`);
  }
  return distribution;
}

function normalizeMember(value: unknown, index: number): MemberRecord {
  if (!isRecord(value)) {
    throw new Error(`Invalid snapshot field: members[${index}]`);
  }

  return {
    id: requiredString(value.id, `members[${index}].id`),
    nickname: requiredString(value.nickname, `members[${index}].nickname`),
    role: value.role === 'host' || value.role === 'voter' || value.role === 'observer'
      ? value.role
      : (() => { throw new Error(`Invalid snapshot field: members[${index}].role`); })(),
    joinedAt: requiredString(value.joinedAt, `members[${index}].joinedAt`),
    lastSeenAt: requiredString(value.lastSeenAt, `members[${index}].lastSeenAt`),
    online: requiredBoolean(value.online, `members[${index}].online`),
  };
}

function normalizeRound(value: unknown, field: string): RoundRecord {
  if (!isRecord(value)) {
    throw new Error(`Invalid snapshot field: ${field}`);
  }

  const status = value.status === 'voting' || value.status === 'revealed' || value.status === 'archived'
    ? value.status
    : (() => { throw new Error(`Invalid snapshot field: ${field}.status`); })();

  return {
    id: requiredString(value.id, `${field}.id`),
    number: requiredNumber(value.number, `${field}.number`),
    status,
    finalEstimate: nullableString(value.finalEstimate, `${field}.finalEstimate`),
    startedAt: requiredString(value.startedAt, `${field}.startedAt`),
    revealedAt: nullableString(value.revealedAt, `${field}.revealedAt`),
    archivedAt: nullableString(value.archivedAt, `${field}.archivedAt`),
  };
}

function normalizeArchivedRound(value: unknown, index: number): ArchivedRoundRecord {
  if (!isRecord(value)) {
    throw new Error(`Invalid snapshot field: recentRounds[${index}]`);
  }

  return {
    ...normalizeRound(value, `recentRounds[${index}]`),
    distribution: validateDistribution(value.distribution, `recentRounds[${index}].distribution`),
  };
}

export function normalizeRoomSnapshot(snapshot: unknown): RoomSnapshot {
  if (!isRecord(snapshot)) {
    throw new Error('Invalid room snapshot: snapshot');
  }

  if (!isRecord(snapshot.room)) {
    throw new Error('Invalid snapshot field: room');
  }
  const room = snapshot.room;
  const membersValue = snapshot.members;
  if (!Array.isArray(membersValue)) {
    throw new Error('Invalid snapshot field: members');
  }
  if (!isRecord(snapshot.round)) {
    throw new Error('Invalid snapshot field: round');
  }
  if (typeof snapshot.myMemberId !== 'string' || !snapshot.myMemberId.trim()) {
    throw new Error('Invalid snapshot field: myMemberId');
  }
  if (typeof snapshot.myVote !== 'string' && snapshot.myVote !== null) {
    throw new Error('Invalid snapshot field: myVote');
  }
  if (snapshot.myVote !== null && !FIBONACCI_CARDS.includes(snapshot.myVote as VoteValue)) {
    throw new Error('Invalid snapshot field: myVote');
  }
  if (typeof snapshot.submittedCount !== 'number' || !Number.isFinite(snapshot.submittedCount)) {
    throw new Error('Invalid snapshot field: submittedCount');
  }
  if (snapshot.distribution !== null && !isRecord(snapshot.distribution)) {
    throw new Error('Invalid snapshot field: distribution');
  }
  if (!Array.isArray(snapshot.recentRounds)) {
    throw new Error('Invalid snapshot field: recentRounds');
  }

  return {
    room: {
      id: requiredString(room.id, 'room.id'),
      code: requiredString(room.code, 'room.code'),
      name: requiredString(room.name, 'room.name'),
      hostMemberId: requiredString(room.hostMemberId, 'room.hostMemberId'),
      maxMembers: requiredNumber(room.maxMembers, 'room.maxMembers'),
      createdAt: requiredString(room.createdAt, 'room.createdAt'),
    },
    myMemberId: snapshot.myMemberId,
    members: membersValue.map((member, index) => normalizeMember(member, index)),
    round: normalizeRound(snapshot.round, 'round'),
    myVote: snapshot.myVote as VoteValue | null,
    submittedCount: snapshot.submittedCount,
    distribution: snapshot.distribution === null ? null : validateDistribution(snapshot.distribution, 'distribution'),
    recentRounds: snapshot.recentRounds.map((round, index) => normalizeArchivedRound(round, index)),
  };
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabaseClient().rpc(name as keyof Database['public']['Functions'], args as never);
  if (error) {
    throw toError(error);
  }
  return data as T;
}

export async function ensureAnonymousSession(): Promise<void> {
  const { error } = await getSupabaseClient().auth.signInAnonymously();
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
  const client = getSupabaseClient();
  const { data: userData } = await client.auth.getUser();
  const userId = userData?.user?.id ?? '';

  if (!userId) {
    await ensureAnonymousSession();
  }

  const { data: refreshedUserData } = await client.auth.getUser();
  const resolvedUserId = refreshedUserData?.user?.id ?? userId;

  const response = await rpc<RoomSnapshotJson>('build_room_snapshot', {
    p_room_id: roomId,
    p_user_id: resolvedUserId,
  });

  return normalizeRoomSnapshot(response);
}
