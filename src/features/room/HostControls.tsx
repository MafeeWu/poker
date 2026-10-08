import { useState } from 'react';
import { suggestFinalEstimate } from '../../domain/roundOutcome';
import type { RoomSnapshot } from '../../lib/roomApi';
import type { ConnectionStatusValue } from './ConnectionStatus';
import { RoundOutcomeForm } from './RoundOutcomeForm';

export type HostControlsProps = {
  state: RoomSnapshot;
  status: ConnectionStatusValue;
  onReveal: () => void;
  onSaveOutcome: (finalEstimate: string | null, note: string | null) => void;
  onNextRound: (finalEstimate: string, note: string | null) => void;
  onTransferHost: (memberId: string) => void;
  outcomeError: string | null;
  pendingAction?: 'vote' | 'reveal' | 'outcome' | 'next' | 'transfer' | null;
};

export function HostControls({ state, status, onReveal, onSaveOutcome, onNextRound, onTransferHost, outcomeError, pendingAction = null }: HostControlsProps) {
  const currentMember = state.members.find((member) => member.id === state.myMemberId);
  const isHost = currentMember?.role === 'host' || state.room.hostMemberId === state.myMemberId;
  const actionsUnavailable = status !== 'connected';
  const [transferTarget, setTransferTarget] = useState('');

  if (!isHost) {
    return null;
  }

  const transferOptions = state.members.filter((member) => member.id !== state.myMemberId);

  return (
    <section className="host-controls">
      {state.round.status === 'voting' ? <button type="button" className="arcade-button" data-testid="reveal-button" onClick={onReveal} disabled={actionsUnavailable || pendingAction === 'reveal'}>Reveal</button> : null}

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

      {transferOptions.length > 0 ? (
        <div>
          <label>
            Transfer host
            <select value={transferTarget} onChange={(event) => setTransferTarget(event.target.value)} disabled={actionsUnavailable || pendingAction === 'transfer'}>
              <option value="">Select member</option>
              {transferOptions.map((member) => (
                <option key={member.id} value={member.id}>{member.nickname}</option>
              ))}
            </select>
          </label>
          <button type="button" className="arcade-button" onClick={() => transferTarget && onTransferHost(transferTarget)} disabled={actionsUnavailable || pendingAction === 'transfer'}>
            Transfer host
          </button>
        </div>
      ) : null}
    </section>
  );
}
