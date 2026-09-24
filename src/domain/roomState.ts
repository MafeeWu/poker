import type { VoteDistribution, VoteValue } from './poker';

export type RoundStatus = 'voting' | 'revealed' | 'archived';
export type MemberRole = 'host' | 'voter' | 'observer';

export type RoomAction =
  | { type: 'vote'; value: VoteValue }
  | { type: 'reveal' }
  | { type: 'archive'; finalEstimate: string }
  | { type: 'start-next-round' };

export type RoomState = {
  roundId: string;
  roundNumber: number;
  status: RoundStatus;
  role: MemberRole;
  selectedVote: VoteValue | null;
  distribution: VoteDistribution | null;
  finalEstimate: string | null;
};

export function canPerformAction(state: RoomState, action: RoomAction): boolean {
  switch (action.type) {
    case 'vote':
      return state.role === 'voter' && state.status === 'voting';
    case 'reveal':
      return state.role === 'host' && state.status === 'voting';
    case 'archive':
      return (
        state.role === 'host' &&
        state.status === 'revealed' &&
        typeof action.finalEstimate === 'string' &&
        action.finalEstimate.trim().length > 0
      );
    case 'start-next-round':
      return state.role === 'host' && state.status === 'archived';
    default:
      return false;
  }
}
