import { render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { FIBONACCI_CARDS } from '../../domain/poker';
import type { RoomSnapshot } from '../../lib/roomApi';
import { CardDeck } from './CardDeck';
import { ConnectionStatus } from './ConnectionStatus';
import { RoundBoard } from './RoundBoard';
import { RoomPage } from './RoomPage';
import { HostControls } from './HostControls';
import { saveRecentRoom } from './roomCopy';

const roomApi = vi.hoisted(() => ({
  joinRoom: vi.fn(),
  fetchRoomSnapshot: vi.fn(),
  submitVote: vi.fn(),
  revealRound: vi.fn(),
}));

vi.mock('../../lib/roomApi', async () => {
  const actual = await vi.importActual<typeof import('../../lib/roomApi')>('../../lib/roomApi');
  return { ...actual, ...roomApi };
});

function votingSnapshot(overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
  const base: RoomSnapshot = {
    room: {
      id: 'room-1',
      code: 'AB12CD34',
      name: 'Planning Room',
      hostMemberId: 'member-host',
      maxMembers: 10,
      createdAt: '2024-01-01T00:00:00.000Z',
    },
    myMemberId: 'member-1',
    members: [
      { id: 'member-host', nickname: 'Host', role: 'host', joinedAt: '2024-01-01T00:00:00.000Z', lastSeenAt: '2024-01-01T00:00:00.000Z', online: true },
      { id: 'member-1', nickname: 'You', role: 'voter', joinedAt: '2024-01-01T00:00:00.000Z', lastSeenAt: '2024-01-01T00:00:00.000Z', online: true },
      { id: 'member-2', nickname: 'Other', role: 'voter', joinedAt: '2024-01-01T00:00:00.000Z', lastSeenAt: '2024-01-01T00:00:00.000Z', online: true },
    ],
    round: {
      id: 'round-1',
      number: 1,
      status: 'voting',
      finalEstimate: null,
      startedAt: '2024-01-01T00:00:00.000Z',
      revealedAt: null,
      archivedAt: null,
    },
    myVote: null,
    submittedCount: 1,
    distribution: null,
    recentRounds: [],
  };

  return { ...base, ...overrides };
}

function revealedSnapshot(): RoomSnapshot {
  return votingSnapshot({
    round: {
      id: 'round-1',
      number: 1,
      status: 'revealed',
      finalEstimate: '5',
      startedAt: '2024-01-01T00:00:00.000Z',
      revealedAt: '2024-01-01T00:05:00.000Z',
      archivedAt: null,
    },
    myVote: '5',
    submittedCount: 3,
    distribution: {
      '0': 0,
      '½': 0,
      '1': 0,
      '2': 0,
      '3': 0,
      '5': 2,
      '8': 1,
      '13': 0,
      '21': 0,
      '34': 0,
      '55': 0,
      '∞': 0,
      '?': 0,
    },
  });
}

describe('room UI', () => {
  it('renders every Fibonacci card', () => {
    render(<CardDeck cards={FIBONACCI_CARDS} selected={null} disabled={false} onSelect={vi.fn()} />);
    expect(screen.getAllByRole('button')).toHaveLength(FIBONACCI_CARDS.length);
    expect(screen.getAllByTestId('card-button')).toHaveLength(FIBONACCI_CARDS.length);
  });

  it('marks a selected card without revealing another member vote', () => {
    render(<RoomPage roomCode="AB12CD34" initialSnapshot={votingSnapshot({ myVote: '5' })} />);
    expect(screen.getByRole('button', { name: /5/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText(/other member.*5/i)).not.toBeInTheDocument();
  });

  it('does not render voting controls for an observer', () => {
    render(<RoomPage roomCode="AB12CD34" initialSnapshot={votingSnapshot({
      members: [
        { id: 'member-host', nickname: 'Host', role: 'host', joinedAt: '2024-01-01T00:00:00.000Z', lastSeenAt: '2024-01-01T00:00:00.000Z', online: true },
        { id: 'member-1', nickname: 'You', role: 'observer', joinedAt: '2024-01-01T00:00:00.000Z', lastSeenAt: '2024-01-01T00:00:00.000Z', online: true },
      ],
      myMemberId: 'member-1',
    })} />);
    expect(screen.queryByRole('group', { name: /fibonacci cards/i })).not.toBeInTheDocument();
  });

  it('renders distribution only after the snapshot is revealed', () => {
    const { rerender } = render(<RoundBoard snapshot={votingSnapshot()} />);
    expect(screen.queryByRole('img', { name: /vote distribution/i })).not.toBeInTheDocument();
    expect(screen.getByTestId('round-status')).toHaveTextContent(/waiting for votes/i);
    expect(screen.queryByTestId('distribution-bars')).not.toBeInTheDocument();
    rerender(<RoundBoard snapshot={revealedSnapshot()} />);
    expect(screen.getByRole('img', { name: /vote distribution/i })).toBeInTheDocument();
    expect(screen.getByTestId('round-status')).toHaveTextContent(/revealed/i);
    expect(screen.getByTestId('distribution-bars')).toBeVisible();
  });

  it('exposes stable room identity, membership, connection, and host control selectors', () => {
    const snapshot = { ...revealedSnapshot(), myMemberId: 'member-host' };
    const { rerender } = render(<RoomPage roomCode={snapshot.room.code} initialSnapshot={snapshot} />);

    expect(screen.getByTestId('room-code')).toHaveTextContent(snapshot.room.code);
    expect(screen.getByTestId('member-count')).toHaveTextContent('3');
    expect(screen.getByTestId('connection-status')).toBeInTheDocument();
    expect(screen.getByLabelText(/final estimate/i)).toHaveAttribute('data-testid', 'final-estimate');

    rerender(<RoomPage roomCode={snapshot.room.code} initialSnapshot={votingSnapshot({ myMemberId: 'member-host' })} />);
    expect(screen.getByTestId('reveal-button')).toBeInTheDocument();
  });

  it('shows reconnecting status without claiming a successful vote', () => {
    render(<ConnectionStatus status="reconnecting" />);
    expect(screen.getByText(/reconnecting/i)).toBeInTheDocument();
    expect(screen.queryByText(/vote submitted/i)).not.toBeInTheDocument();
  });

  it('keeps revealed values visible when reduced motion is enabled', () => {
    const originalMatchMedia = window.matchMedia;

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });

    render(<RoundBoard snapshot={revealedSnapshot()} />);

    expect(screen.getByRole('img', { name: /vote distribution/i })).toBeInTheDocument();
    expect(screen.getByText(/final estimate: 5/i)).toBeInTheDocument();
    expect(screen.getByText(/5: 2/i)).toBeInTheDocument();

    Object.defineProperty(window, 'matchMedia', { writable: true, value: originalMatchMedia });
  });

  it('renders host controls only for the host role', () => {
    render(<RoomPage roomCode="AB12CD34" initialSnapshot={votingSnapshot({
      members: [
        { id: 'member-host', nickname: 'Host', role: 'host', joinedAt: '2024-01-01T00:00:00.000Z', lastSeenAt: '2024-01-01T00:00:00.000Z', online: true },
        { id: 'member-1', nickname: 'You', role: 'voter', joinedAt: '2024-01-01T00:00:00.000Z', lastSeenAt: '2024-01-01T00:00:00.000Z', online: true },
      ],
      myMemberId: 'member-1',
    })} />);
    expect(screen.queryByRole('button', { name: /reveal/i })).not.toBeInTheDocument();
  });

  it('disables the host control matching the pending action', () => {
    render(
      <HostControls
        state={votingSnapshot({ myMemberId: 'member-host' })}
        status="connected"
        pendingAction="reveal"
        onReveal={vi.fn()}
        onArchive={vi.fn()}
        onNextRound={vi.fn()}
        onTransferHost={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /reveal/i })).toBeDisabled();
  });

  it('disables every host mutation while the room is reconnecting', () => {
    const state = votingSnapshot({ myMemberId: 'member-host' });
    const controls = {
      onReveal: vi.fn(),
      onArchive: vi.fn(),
      onNextRound: vi.fn(),
      onTransferHost: vi.fn(),
    };
    const { rerender } = render(
      <HostControls state={state} status="connected" {...controls} />,
    );

    expect(screen.getByRole('button', { name: /reveal/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /transfer host/i })).toBeEnabled();
    expect(screen.getByRole('combobox', { name: /transfer host/i })).toBeEnabled();

    rerender(<HostControls state={state} status="reconnecting" {...controls} />);

    expect(screen.getByRole('button', { name: /reveal/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /transfer host/i })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: /transfer host/i })).toBeDisabled();

    const revealed = { ...revealedSnapshot(), myMemberId: 'member-host' };
    rerender(<HostControls state={revealed} status="connected" {...controls} />);
    expect(screen.getByRole('button', { name: /archive/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /transfer host/i })).toBeEnabled();
    expect(screen.getByRole('combobox', { name: /transfer host/i })).toBeEnabled();

    rerender(<HostControls state={revealed} status="reconnecting" {...controls} />);
    expect(screen.getByRole('button', { name: /archive/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /transfer host/i })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: /transfer host/i })).toBeDisabled();

    const archived = votingSnapshot({
      myMemberId: 'member-host',
      round: {
        id: 'round-1',
        number: 1,
        status: 'archived',
        finalEstimate: '5',
        startedAt: '2024-01-01T00:00:00.000Z',
        revealedAt: '2024-01-01T00:05:00.000Z',
        archivedAt: '2024-01-01T00:06:00.000Z',
      },
    });
    rerender(<HostControls state={archived} status="connected" {...controls} />);
    expect(screen.getByRole('button', { name: /next round/i })).toBeEnabled();

    rerender(<HostControls state={archived} status="reconnecting" {...controls} />);
    expect(screen.getByRole('button', { name: /next round/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /transfer host/i })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: /transfer host/i })).toBeDisabled();
  });

  it('blocks voting while the room is reconnecting', async () => {
    roomApi.submitVote.mockResolvedValueOnce(votingSnapshot({ myVote: '5' }));
    render(<RoomPage roomCode="AB12CD34" initialSnapshot={votingSnapshot()} />);

    await waitFor(() => expect(screen.getByText(/actions are unavailable/i)).toBeInTheDocument());
    screen.getByRole('button', { name: /5/i }).click();

    expect(roomApi.submitVote).not.toHaveBeenCalled();
  });

  it('requires explicit identity before joining a deep-linked room', async () => {
    window.localStorage.clear();
    render(<RoomPage roomCode="AB12CD34" />);

    expect(await screen.findByText(/join this room/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/nickname/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/room code/i)).toHaveValue('AB12CD34');
    expect(roomApi.joinRoom).not.toHaveBeenCalled();
  });

  it('recovers a recent room by its UUID instead of its invite code', async () => {
    window.localStorage.clear();
    const snapshot = votingSnapshot();
    roomApi.fetchRoomSnapshot.mockResolvedValueOnce(snapshot);
    saveRecentRoom(snapshot);

    render(<RoomPage roomCode={snapshot.room.code} />);

    expect(await screen.findByTestId('room-code')).toHaveTextContent(snapshot.room.code);
    expect(roomApi.fetchRoomSnapshot).toHaveBeenCalledWith(snapshot.room.id);
  });
});

vi.mock('../../lib/roomSync', () => ({
  subscribeToRoom: vi.fn((_roomId, handlers) => {
    handlers.onConnectionChange('reconnecting');
    return () => undefined;
  }),
  fetchRoomSnapshot: vi.fn(),
}));
