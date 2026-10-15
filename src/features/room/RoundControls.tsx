import { suggestFinalEstimate } from '../../domain/roundOutcome';
import type { RoomSnapshot } from '../../lib/roomApi';
import type { ConnectionStatusValue } from './ConnectionStatus';
import { RoundOutcomeForm } from './RoundOutcomeForm';

export type RoundControlsProps = {
  state: RoomSnapshot;
  status: ConnectionStatusValue;
  onReveal: () => void;
  onSaveOutcome: (finalEstimate: string | null, note: string | null) => void;
  onNextRound: (finalEstimate: string, note: string | null) => void;
  outcomeError: string | null;
  pendingAction?: 'vote' | 'reveal' | 'outcome' | 'next' | null;
};

export function RoundControls({ state, status, onReveal, onSaveOutcome, onNextRound, outcomeError, pendingAction = null }: RoundControlsProps) {
  const currentMember = state.members.find((member) => member.id === state.myMemberId);
  const actionsUnavailable = status !== 'connected' || pendingAction !== null;

  if (currentMember?.role !== 'host' && currentMember?.role !== 'voter') {
    return null;
  }

  return (
    <section className="round-controls" aria-label="Round controls">
      {state.round.status === 'voting' ? <button type="button" className="arcade-button" data-testid="reveal-button" onClick={onReveal} disabled={actionsUnavailable || pendingAction === 'reveal'}>Show</button> : null}

      {state.round.status === 'revealed' ? (
        <RoundOutcomeForm
          roundId={state.round.id}
          finalEstimate={state.round.finalEstimate}
          note={state.round.note}
          suggestion={suggestFinalEstimate(state.distribution)}
          pendingAction={pendingAction === 'outcome' ? 'save' : pendingAction === 'next' ? 'next' : null}
          disabled={actionsUnavailable}
          error={outcomeError}
          onSave={onSaveOutcome}
          onNextRound={onNextRound}
        />
      ) : null}
    </section>
  );
}
