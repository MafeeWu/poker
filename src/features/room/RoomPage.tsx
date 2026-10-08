import { useEffect, useMemo, useState } from 'react';
import { CopyButton } from '../../components/CopyButton';
import { InlineNotice } from '../../components/InlineNotice';
import { FIBONACCI_CARDS, type VoteValue } from '../../domain/poker';
import { archiveRound, fetchRoomSnapshot, revealRound, startNextRound, submitVote, transferHost } from '../../lib/roomApi';
import type { RoomSnapshot } from '../../lib/roomApi';
import { readRecentRooms, saveRecentRoom } from './roomCopy';
import { CardDeck } from './CardDeck';
import { ConnectionStatus, type ConnectionStatusValue } from './ConnectionStatus';
import { HostControls } from './HostControls';
import { MemberRail } from './MemberRail';
import { RoomHeader } from './RoomHeader';
import { RoundBoard } from './RoundBoard';
import { RoomEntryForm } from '../home/RoomEntryForm';

export type RoomPageProps = {
  roomCode: string;
  initialSnapshot?: RoomSnapshot;
};

export function RoomPage({ roomCode, initialSnapshot }: RoomPageProps) {
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(initialSnapshot ?? null);
  const [status, setStatus] = useState<ConnectionStatusValue>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<'vote' | 'reveal' | 'archive' | 'next' | 'transfer' | null>(null);
  const [needsJoin, setNeedsJoin] = useState(false);

  useEffect(() => {
    if (initialSnapshot) {
      setSnapshot(initialSnapshot);
      setStatus('connected');
      setNeedsJoin(false);
      return;
    }

    const recentRoom = readRecentRooms().find((entry) => entry.code === roomCode.toUpperCase());

    const recover = async () => {
      try {
        setStatus('connecting');

        if (recentRoom && recentRoom.memberId) {
          const nextSnapshot = await fetchRoomSnapshot(recentRoom.roomId);
          setSnapshot(nextSnapshot);
          setStatus('connected');
          saveRecentRoom(nextSnapshot);
          return;
        }

        setNeedsJoin(true);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : 'Unable to load room');
        setStatus('error');
      }
    };

    void recover();
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

  const handleArchive = async (finalEstimate: string) => {
    if (!snapshot || status !== 'connected' || pendingAction || !finalEstimate.trim()) {
      return;
    }

    setPendingAction('archive');
    try {
      const nextSnapshot = await archiveRound(snapshot.room.id, snapshot.round.id, finalEstimate);
      setSnapshot(nextSnapshot);
      setError(null);
      saveRecentRoom(nextSnapshot);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to archive round');
    } finally {
      setPendingAction(null);
    }
  };

  const handleNextRound = async () => {
    if (!snapshot || status !== 'connected' || pendingAction) {
      return;
    }

    setPendingAction('next');
    try {
      const nextSnapshot = await startNextRound(snapshot.room.id, snapshot.round.id);
      setSnapshot(nextSnapshot);
      setError(null);
      saveRecentRoom(nextSnapshot);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to start next round');
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
      <main>
        <ConnectionStatus status={status} />
        {error ? <p role="alert">{error}</p> : null}
        {needsJoin ? (
          <section>
            <h1>Join this room</h1>
            <RoomEntryForm
              mode="join"
              initialRoomCode={roomCode.toUpperCase()}
              onSuccess={(nextSnapshot) => {
                setSnapshot(nextSnapshot);
                setNeedsJoin(false);
                setStatus('connected');
                setError(null);
                saveRecentRoom(nextSnapshot);
              }}
            />
          </section>
        ) : <p>Loading room…</p>}
      </main>
    );
  }

  const canVote = snapshot.round.status === 'voting' && currentMember?.role === 'voter';

  return (
    <main className="room-shell">
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
        </section>

        <MemberRail snapshot={snapshot} />
      </div>

      <HostControls
        state={snapshot}
        onReveal={handleReveal}
        onArchive={handleArchive}
        onNextRound={handleNextRound}
        onTransferHost={handleTransferHost}
        status={status}
        pendingAction={pendingAction}
      />
    </main>
  );
}
