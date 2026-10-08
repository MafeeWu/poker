export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export type VoteValue = '0' | '½' | '1' | '2' | '3' | '5' | '8' | '13' | '21' | '34' | '55' | '∞' | '?';
export type VoteDistribution = Record<VoteValue, number>;

export type RoomStatus = 'voting' | 'revealed' | 'archived';
export type MemberRole = 'host' | 'voter' | 'observer';

export type RoomRecordRow = {
  id: string;
  code: string;
  name: string;
  host_member_id: string | null;
  max_members: number;
  created_at: string;
};

export type MemberRecordRow = {
  id: string;
  nickname: string;
  role: MemberRole;
  joined_at: string;
  last_seen_at: string;
  online: boolean;
  last_voted_round_id: string | null;
};

export type RoundRecordRow = {
  id: string;
  round_number: number;
  status: RoomStatus;
  final_estimate: string | null;
  note: string | null;
  started_at: string;
  revealed_at: string | null;
  archived_at: string | null;
};

export type ArchivedRoundRecordRow = RoundRecordRow & {
  distribution: VoteDistribution;
};

export type MemberRecordJson = {
  id: string;
  nickname: string;
  role: MemberRole;
  joinedAt: string;
  lastSeenAt: string;
  online: boolean;
  hasVoted: boolean;
  vote: VoteValue | null;
};

export type RoundRecordJson = {
  id: string;
  number: number;
  status: RoomStatus;
  finalEstimate: string | null;
  note: string | null;
  startedAt: string;
  revealedAt: string | null;
  archivedAt: string | null;
};

export type ArchivedRoundRecordJson = RoundRecordJson & {
  distribution: VoteDistribution;
};

export type RoomSnapshotJson = {
  room: {
    id: string;
    code: string;
    name: string;
    hostMemberId: string;
    maxMembers: number;
    createdAt: string;
  };
  myMemberId?: string;
  members: MemberRecordJson[];
  round: RoundRecordJson;
  myVote: VoteValue | null;
  submittedCount?: number;
  distribution: VoteDistribution | null;
  recentRounds: ArchivedRoundRecordJson[];
};

export type Database = {
  public: {
    Tables: {
      rooms: {
        Row: RoomRecordRow;
      };
      room_members: {
        Row: MemberRecordRow;
      };
      rounds: {
        Row: RoundRecordRow;
      };
      votes: {
        Row: {
          id: string;
          room_id: string;
          round_id: string;
          member_id: string;
          value: VoteValue;
        };
      };
    };
    Views: Record<string, never>;
    Functions: {
      create_room: {
        Args: { p_name: string; p_nickname: string };
        Returns: RoomSnapshotJson;
      };
      join_room: {
        Args: { p_code: string; p_nickname: string; p_role: 'voter' | 'observer' };
        Returns: RoomSnapshotJson;
      };
      heartbeat_member: {
        Args: { p_room_id: string; p_member_id: string };
        Returns: void;
      };
      submit_vote: {
        Args: { p_room_id: string; p_round_id: string; p_value: VoteValue };
        Returns: RoomSnapshotJson;
      };
      reveal_round: {
        Args: { p_room_id: string; p_round_id: string };
        Returns: RoomSnapshotJson;
      };
      update_round_outcome: {
        Args: {
          p_room_id: string;
          p_round_id: string;
          p_final_estimate: string | null;
          p_note: string | null;
        };
        Returns: RoomSnapshotJson;
      };
      complete_round_and_start_next_round: {
        Args: {
          p_room_id: string;
          p_round_id: string;
          p_final_estimate: string;
          p_note: string | null;
        };
        Returns: RoomSnapshotJson;
      };
      transfer_host: {
        Args: { p_room_id: string; p_member_id: string };
        Returns: RoomSnapshotJson;
      };
      leave_room: {
        Args: { p_room_id: string; p_member_id: string };
        Returns: void;
      };
      build_room_snapshot: {
        Args: { p_room_id: string; p_user_id: string };
        Returns: RoomSnapshotJson;
      };
    };
  };
};
