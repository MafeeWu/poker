import { useEffect, useMemo, useState } from 'react';
import { CopyButton } from '../../components/CopyButton';
import { InlineNotice } from '../../components/InlineNotice';
import { FIBONACCI_CARDS, type VoteValue } from '../../domain/poker';
import { completeRoundAndStartNextRound, restoreRoomSession, revealRound, submitVote, transferHost, updateRoundOutcome } from '../../lib/roomApi';
import type { RoomSnapshot } from '../../lib/roomApi';
import { readRecentRooms, saveRecentRoom } from './roomCopy';
import { CardDeck } from './CardDeck';
import { ConnectionStatus, type ConnectionStatusValue } from './ConnectionStatus';
import { HostControls } from './HostControls';
import { MemberGrid } from './MemberGrid';
import { RoomHeader } from './RoomHeader';
import { RoundBoard } from './RoundBoard';
import { VoteDistribution } from './VoteDistribution';
import { RoundHistory } from './RoundHistory';
import { RoomEntryForm } from '../home/RoomEntryForm';

export type RoomPageProps = {
  roomCode: string;
  initialSnapshot?: RoomSnapshot;
};

export function RoomPage({ roomCode, initialSnapshot }: RoomPageProps) {
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(initialSnapshot ?? null);
  const [status, setStatus] = useState<ConnectionStatusValue>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<'vote' | 'reveal' | 'outcome' | 'next' | 'transfer' | null>(null);
  const [outcomeError, setOutcomeError] = useState<string | null>(null);
  const [needsJoin, setNeedsJoin] = useState(false);
  const [joinNotice, setJoinNotice] = useState<string | null>(null);

  useEffect(() => {
    if (initialSnapshot) {
      setSnapshot(initialSnapshot);
      setStatus('connected');
      setNeedsJoin(false);
      return;
    }

    const recentRoom = readRecentRooms().find((entry) => entry.code === roomCode.toUpperCase());
    let isActive = true;

    const recover = async () => {
      try {
        setStatus('connecting');
        const nextSnapshot = await restoreRoomSession(roomCode);
        if (!isActive) {
          return;
        }

        if (nextSnapshot) {
          setSnapshot(nextSnapshot);
          setStatus('connected');
          saveRecentRoom(nextSnapshot);
          return;
        }

        setNeedsJoin(true);
        if (recentRoom) {
          setJoinNotice('Your previous room session is no longer available. Enter your nickname to join again.');
        }
      } catch (caughtError) {
        if (!isActive) {
          return;
        }
        if (caughtError instanceof Error && caughtError.message === 'Membership required') {
          setError(null);
          setNeedsJoin(true);
          setJoinNotice('Your previous room session is no longer available. Enter your nickname to join again.');
          return;
        }
        setError(caughtError instanceof Error ? caughtError.message : 'Unable to load room');
        setStatus('error');
      }
    };

    void recover();
    return () => {
      isActive = false;
    };
  }, [initialSnapshot, roomCode]);

  useEffect(() => {
    if (!snapshot) {
      return;
    }

    let isActive = true;
    let cleanup: (() => void) | undefined;

    void import('../../lib/roomSync').then(({ subscribeToRoom }) => {
      if (!isActive) {
        return;
      }

      cleanup = subscribeToRoom(snapshot.room.id, {
        onSnapshot: (nextSnapshot) => {
          setSnapshot(nextSnapshot);
          saveRecentRoom(nextSnapshot);
          setStatus('connected');
        },
        onConnectionChange: (nextStatus) => setStatus(nextStatus),
        onError: (caughtError) => {
          setError(caughtError.message);
        },
      });
    });

    return () => {
      isActive = false;
      cleanup?.();
    };
  }, [snapshot?.room.id]);

  const handleVote = async (value: VoteValue) => {
    if (!snapshot || status !== 'connected' || pendingAction || snapshot.round.status !== 'voting') {
      return;
    }

    setPendingAction('vote');
    try {
      const nextSnapshot = await submitVote(snapshot.room.id, snapshot.round.id, value);
      setSnapshot(nextSnapshot);
      setError(null);
      saveRecentRoom(nextSnapshot);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to submit vote');
    } finally {
      setPendingAction(null);
    }
  };

  const handleReveal = async () => {
    if (!snapshot || status !== 'connected' || pendingAction) {
      return;
    }

    setPendingAction('reveal');
    try {
      const nextSnapshot = await revealRound(snapshot.room.id, snapshot.round.id);
      setSnapshot(nextSnapshot);
      setError(null);
      saveRecentRoom(nextSnapshot);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to reveal votes');
    } finally {
      setPendingAction(null);
    }
  };

  const handleUpdateOutcome = async (finalEstimate: string | null, note: string | null) => {
    if (!snapshot || status !== 'connected' || pendingAction) {
      return;
    }

    setPendingAction('outcome');
    try {
      const nextSnapshot = await updateRoundOutcome(snapshot.room.id, snapshot.round.id, finalEstimate, note);
      setSnapshot(nextSnapshot);
      setOutcomeError(null);
      saveRecentRoom(nextSnapshot);
    } catch (caughtError) {
      setOutcomeError(caughtError instanceof Error ? caughtError.message : 'Unable to save round outcome');
    } finally {
      setPendingAction(null);
    }
  };

  const handleNextRound = async (finalEstimate: string, note: string | null) => {
    if (!snapshot || status !== 'connected' || pendingAction) {
      return;
    }

    setPendingAction('next');
    try {
      const nextSnapshot = await completeRoundAndStartNextRound(snapshot.room.id, snapshot.round.id, finalEstimate, note);
      setSnapshot(nextSnapshot);
      setError(null);
      setOutcomeError(null);
      saveRecentRoom(nextSnapshot);
    } catch (caughtError) {
      setOutcomeError(caughtError instanceof Error ? caughtError.message : 'Unable to start next round');
    } finally {
      setPendingAction(null);
    }
  };

  const handleTransferHost = async (memberId: string) => {
    if (!snapshot || status !== 'connected' || pendingAction || !memberId) {
      return;
    }

    setPendingAction('transfer');
    try {
      const nextSnapshot = await transferHost(snapshot.room.id, memberId);
      setSnapshot(nextSnapshot);
      setError(null);
      saveRecentRoom(nextSnapshot);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to transfer host');
    } finally {
      setPendingAction(null);
    }
  };

  const currentMember = useMemo(
    () => snapshot?.members.find((member) => member.id === snapshot?.myMemberId),
    [snapshot],
  );

  if (!snapshot) {
    return (
      <main data-theme="arcade">
        {!needsJoin ? <ConnectionStatus status={status} /> : null}
        {error ? <p role="alert">{error}</p> : null}
        {needsJoin ? (
          <section>
            <h1>Join this room</h1>
            {joinNotice ? <p role="status">{joinNotice}</p> : null}
            <RoomEntryForm
              mode="join"
              initialRoomCode={roomCode.toUpperCase()}
              onSuccess={(nextSnapshot) => {
                setSnapshot(nextSnapshot);
                setNeedsJoin(false);
                setStatus('connected');
                setError(null);
                setJoinNotice(null);
                saveRecentRoom(nextSnapshot);
              }}
            />
          </section>
        ) : !error ? <p>Loading room…</p> : null}
      </main>
    );
  }

  const canVote = snapshot.round.status === 'voting' && (currentMember?.role === 'voter' || currentMember?.role === 'host');

  return (
    <main className="room-shell" data-theme="arcade">
      <RoomHeader snapshot={snapshot} />

      <div className="action-row">
        <ConnectionStatus status={status} />
        <CopyButton value={typeof window !== 'undefined' ? `${window.location.origin}/room/${snapshot.room.code}` : `/room/${snapshot.room.code}`} label="Copy share link" />
      </div>

      {status !== 'connected' ? (
        <InlineNotice tone="info" title="Connection status">Actions are unavailable while disconnected.</InlineNotice>
      ) : null}

      {error ? <InlineNotice tone="error" title="Room alert">{error}</InlineNotice> : null}

      <div className="table-shell">
        <section className="table-panel">
          <RoundBoard snapshot={snapshot} />
          {canVote ? (
            <CardDeck
              cards={FIBONACCI_CARDS}
              selected={snapshot.myVote}
              disabled={status !== 'connected' || pendingAction !== null || snapshot.round.status !== 'voting'}
              onSelect={handleVote}
            />
          ) : null}
          <MemberGrid members={snapshot.members} roundStatus={snapshot.round.status} />
          {snapshot.round.status !== 'voting' ? <VoteDistribution distribution={snapshot.distribution} /> : null}
          {snapshot.round.status !== 'voting' && snapshot.round.finalEstimate ? (
            <p className="round-status" data-testid="final-estimate-value">Final estimate: {snapshot.round.finalEstimate}</p>
          ) : null}
          {snapshot.round.status !== 'voting' && snapshot.round.note !== null && currentMember?.role !== 'host' ? (
            <p className="round-status" data-testid="current-round-note">Note: {snapshot.round.note}</p>
          ) : null}
          <RoundHistory rounds={snapshot.recentRounds} />
        </section>
      </div>

      <HostControls
        state={snapshot}
        onReveal={handleReveal}
        onSaveOutcome={handleUpdateOutcome}
        onNextRound={handleNextRound}
        onTransferHost={handleTransferHost}
        outcomeError={outcomeError}
        status={status}
        pendingAction={pendingAction}
      />
    </main>
  );
}
