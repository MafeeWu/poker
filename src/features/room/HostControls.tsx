import { useEffect, useState } from 'react';
import type { RoomSnapshot } from '../../lib/roomApi';
import type { ConnectionStatusValue } from './ConnectionStatus';

export type HostControlsProps = {
  state: RoomSnapshot;
  status: ConnectionStatusValue;
  onReveal: () => void;
  onArchive: (finalEstimate: string) => void;
  onNextRound: () => void;
  onTransferHost: (memberId: string) => void;
  pendingAction?: 'vote' | 'reveal' | 'archive' | 'next' | 'transfer' | null;
};

export function HostControls({ state, status, onReveal, onArchive, onNextRound, onTransferHost, pendingAction = null }: HostControlsProps) {
  const currentMember = state.members.find((member) => member.id === state.myMemberId);
  const isHost = currentMember?.role === 'host' || state.room.hostMemberId === state.myMemberId;
  const actionsUnavailable = status !== 'connected';
  const [finalEstimate, setFinalEstimate] = useState(state.round.finalEstimate ?? '');
  const [transferTarget, setTransferTarget] = useState('');

  useEffect(() => {
    setFinalEstimate(state.round.finalEstimate ?? '');
  }, [state.round.finalEstimate]);

  if (!isHost) {
    return null;
  }

  const transferOptions = state.members.filter((member) => member.id !== state.myMemberId);

  return (
    <section>
      {state.round.status === 'voting' ? <button type="button" data-testid="reveal-button" onClick={onReveal} disabled={actionsUnavailable || pendingAction === 'reveal'}>Reveal</button> : null}

      {state.round.status === 'revealed' ? (
        <div>
          <label>
            Final estimate
            <input
              type="text"
              data-testid="final-estimate"
              value={finalEstimate}
              onChange={(event) => setFinalEstimate(event.target.value)}
            />
          </label>
          <button type="button" onClick={() => onArchive(finalEstimate)} disabled={actionsUnavailable || pendingAction === 'archive'}>Archive</button>
        </div>
      ) : null}

      {state.round.status === 'archived' ? (
        <button type="button" onClick={onNextRound} disabled={actionsUnavailable || pendingAction === 'next'}>Next round</button>
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
          <button type="button" onClick={() => transferTarget && onTransferHost(transferTarget)} disabled={actionsUnavailable || pendingAction === 'transfer'}>
            Transfer host
          </button>
        </div>
      ) : null}
    </section>
  );
}
