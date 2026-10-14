import { useEffect, useMemo, useRef, useState } from 'react';
import { CopyButton } from '../../components/CopyButton';
import { InlineNotice } from '../../components/InlineNotice';
import { FIBONACCI_CARDS, type VoteValue } from '../../domain/poker';
import { completeRoundAndStartNextRound, restoreRoomSession, revealRound, submitVote, updateRoundOutcome } from '../../lib/roomApi';
import type { RoomSnapshot } from '../../lib/roomApi';
import { readRecentRooms, saveRecentRoom } from './roomCopy';
import { CardDeck } from './CardDeck';
import { ConnectionStatus, type ConnectionStatusValue } from './ConnectionStatus';
import { RoundControls } from './RoundControls';
import { MemberGrid } from './MemberGrid';
import { RoomHeader } from './RoomHeader';
import { RoundBoard } from './RoundBoard';
import { VoteDistribution } from './VoteDistribution';
import { RoundHistory } from './RoundHistory';
import { RoomEntryForm } from '../home/RoomEntryForm';
import type { RoomSubscription, VoteAnimationEvent } from '../../lib/roomSync';

export type RoomPageProps = {
  roomCode: string;
  initialSnapshot?: RoomSnapshot;
};

export function RoomPage({ roomCode, initialSnapshot }: RoomPageProps) {
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(initialSnapshot ?? null);
  const [status, setStatus] = useState<ConnectionStatusValue>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<'vote' | 'reveal' | 'outcome' | 'next' | null>(null);
  const [outcomeError, setOutcomeError] = useState<string | null>(null);
  const [needsJoin, setNeedsJoin] = useState(false);
  const [joinNotice, setJoinNotice] = useState<string | null>(null);
  const roomSubscription = useRef<RoomSubscription | null>(null);
  const [voteAnimations, setVoteAnimations] = useState<Record<string, VoteAnimationEvent>>({});

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

      const subscription = subscribeToRoom(snapshot.room.id, {
        onSnapshot: (nextSnapshot) => {
          setSnapshot(nextSnapshot);
          saveRecentRoom(nextSnapshot);
        },
        onConnectionChange: (nextStatus) => {
          setStatus(nextStatus);
          if (nextStatus === 'connected') setSyncError(null);
        },
        onError: (caughtError) => {
          setSyncError(caughtError.message);
        },
        onVoteAnimation: (event) => {
          setVoteAnimations((current) => ({ ...current, [event.memberId]: event }));
        },
      }, snapshot.myMemberId);
      roomSubscription.current = subscription;
      cleanup = () => {
        subscription.unsubscribe();
        if (roomSubscription.current === subscription) roomSubscription.current = null;
      };
    });

    return () => {
      isActive = false;
      cleanup?.();
    };
  }, [snapshot?.room.id, snapshot?.myMemberId]);

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
      if (!roomSubscription.current) {
        throw new Error('Vote saved, but the member animation could not be synchronized.');
      }
      await roomSubscription.current.sendVoteAnimation(nextSnapshot.myMemberId, nextSnapshot.round.id);
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

  const currentMember = useMemo(
    () => snapshot?.members.find((member) => member.id === snapshot?.myMemberId),
    [snapshot],
  );

  if (!snapshot) {
    return (
      <main className="state-shell" data-theme="arcade">
        <a className="back-link" href="/" aria-label="Back to home"><span aria-hidden="true">←</span> Back to home</a>
        <section className="state-panel">
          <img className="state-joker" src="/joker.svg" alt="" />
          <p className="eyebrow">A SEAT AT THE TABLE</p>
          {!needsJoin ? <ConnectionStatus status={status} /> : null}
          {error ? (
            <>
              <h1>Could not open this table.</h1>
              <p className="form-error" role="alert">{error}</p>
            </>
          ) : null}
          {needsJoin ? (
            <>
              <h1>Join this room</h1>
              <p>Your team has saved you a seat.</p>
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
            </>
          ) : !error ? <p role="status">Loading room…</p> : null}
        </section>
      </main>
    );
  }

  const canVote = snapshot.round.status === 'voting' && (currentMember?.role === 'voter' || currentMember?.role === 'host');
  const isSubmittingVote = pendingAction === 'vote' && status === 'connected';

  return (
    <main
      className={isSubmittingVote ? 'room-shell is-submitting-vote' : 'room-shell'}
      data-theme="arcade"
      aria-busy={pendingAction !== null}
    >
      <RoomHeader snapshot={snapshot}>
        <div className="room-header-tools">
          <ConnectionStatus status={status} />
          <CopyButton value={typeof window !== 'undefined' ? `${window.location.origin}/room/${snapshot.room.code}` : `/room/${snapshot.room.code}`} label="Copy share link" />
        </div>
      </RoomHeader>

      {status !== 'connected' ? (
        <InlineNotice tone="info" title="Connection status">Actions are unavailable while disconnected.</InlineNotice>
      ) : null}

      {error ? <InlineNotice tone="error" title="Room alert">{error}</InlineNotice> : null}
      {syncError ? <InlineNotice tone="error" title="Connection error">{syncError}</InlineNotice> : null}

      <RoundBoard snapshot={snapshot} />
      <div className="table-shell">
        <section className="table-panel">
          {canVote ? (
            <div className="deck-section">
              <div className="deck-heading"><h2>Pick your estimate</h2><span>Your vote stays private until reveal.</span></div>
              <CardDeck
                cards={FIBONACCI_CARDS}
                selected={snapshot.myVote}
                disabled={status !== 'connected' || pendingAction !== null || snapshot.round.status !== 'voting'}
                onSelect={handleVote}
              />
            </div>
          ) : null}
          <MemberGrid members={snapshot.members} roundStatus={snapshot.round.status} roundId={snapshot.round.id} voteAnimations={voteAnimations} />
          {snapshot.round.status !== 'voting' ? <VoteDistribution distribution={snapshot.distribution} /> : null}
          {snapshot.round.status !== 'voting' && snapshot.round.finalEstimate ? (
            <p className="round-status" data-testid="final-estimate-value">Final estimate: {snapshot.round.finalEstimate}</p>
          ) : null}
          {snapshot.round.status !== 'voting' && snapshot.round.note !== null && currentMember?.role === 'observer' ? (
            <p className="round-status" data-testid="current-round-note">Note: {snapshot.round.note}</p>
          ) : null}
          <div className="member-legend" aria-label="Card status">
            <span><i className="legend-pending" aria-hidden="true" />Waiting</span>
            <span><i className="legend-voted" aria-hidden="true" />Voted</span>
            <span><i className="legend-observer" aria-hidden="true" />Observer</span>
            <span><i className="legend-offline" aria-hidden="true" />Offline</span>
          </div>
        </section>
        <RoundHistory rounds={snapshot.recentRounds} />
      </div>

      <RoundControls
        state={snapshot}
        onReveal={handleReveal}
        onSaveOutcome={handleUpdateOutcome}
        onNextRound={handleNextRound}
        outcomeError={outcomeError}
        status={status}
        pendingAction={pendingAction}
      />
    </main>
  );
}
