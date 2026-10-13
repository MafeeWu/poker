import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { FIBONACCI_CARDS } from '../../domain/poker';
import type { RoomSnapshot } from '../../lib/roomApi';
import { CardDeck } from './CardDeck';
import { ConnectionStatus } from './ConnectionStatus';
import { RoundBoard } from './RoundBoard';
import { RoomPage } from './RoomPage';
import { HostControls } from './HostControls';
import { saveRecentRoom } from './roomCopy';

const roomSyncState = vi.hoisted(() => ({ status: 'connected' as 'connected' | 'reconnecting' }));

const roomApi = vi.hoisted(() => ({
  joinRoom: vi.fn(),
  fetchRoomSnapshot: vi.fn(),
  restoreRoomSession: vi.fn(),
  submitVote: vi.fn(),
  revealRound: vi.fn(),
  updateRoundOutcome: vi.fn(),
  completeRoundAndStartNextRound: vi.fn(),
  transferHost: vi.fn(),
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
      { id: 'member-host', nickname: 'Host', role: 'host', joinedAt: '2024-01-01T00:00:00.000Z', lastSeenAt: '2024-01-01T00:00:00.000Z', online: true, hasVoted: false, vote: null },
      { id: 'member-1', nickname: 'You', role: 'voter', joinedAt: '2024-01-01T00:00:00.000Z', lastSeenAt: '2024-01-01T00:00:00.000Z', online: true, hasVoted: true, vote: null },
      { id: 'member-2', nickname: 'Other', role: 'voter', joinedAt: '2024-01-01T00:00:00.000Z', lastSeenAt: '2024-01-01T00:00:00.000Z', online: true, hasVoted: false, vote: null },
    ],
    round: {
      id: 'round-1',
      number: 1,
      status: 'voting',
      finalEstimate: null,
      note: null,
      startedAt: '2024-01-01T00:00:00.000Z',
      revealedAt: null,
      archivedAt: null,
    },
    myVote: null,
    submittedCount: 1,
    distribution: null,
    recentRounds: [{
      id: 'round-0',
      number: 0,
      status: 'archived',
      finalEstimate: '3',
      note: 'Earlier round',
      startedAt: '2023-12-31T00:00:00.000Z',
      revealedAt: '2023-12-31T00:05:00.000Z',
      archivedAt: '2023-12-31T00:06:00.000Z',
      distribution: {
        '0': 0, '½': 0, '1': 0, '2': 0, '3': 1, '5': 0, '8': 0,
        '13': 0, '21': 0, '34': 0, '55': 0, '∞': 0, '?': 0,
      },
    }],
  };

  return { ...base, ...overrides };
}

function revealedSnapshot(): RoomSnapshot {
  return votingSnapshot({
    members: [
      { id: 'member-host', nickname: 'Host', role: 'host', joinedAt: '2024-01-01T00:00:00.000Z', lastSeenAt: '2024-01-01T00:00:00.000Z', online: true, hasVoted: true, vote: '5' },
      { id: 'member-1', nickname: 'You', role: 'voter', joinedAt: '2024-01-01T00:00:00.000Z', lastSeenAt: '2024-01-01T00:00:00.000Z', online: true, hasVoted: true, vote: '5' },
      { id: 'member-2', nickname: 'Other', role: 'voter', joinedAt: '2024-01-01T00:00:00.000Z', lastSeenAt: '2024-01-01T00:00:00.000Z', online: true, hasVoted: true, vote: '8' },
    ],
    round: {
      id: 'round-1',
      number: 1,
      status: 'revealed',
      finalEstimate: '5',
      note: null,
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
  beforeEach(() => {
    roomSyncState.status = 'connected';
    vi.clearAllMocks();
    roomApi.submitVote.mockReset();
    roomApi.updateRoundOutcome.mockReset();
    roomApi.completeRoundAndStartNextRound.mockReset();
    roomApi.revealRound.mockReset();
    roomApi.transferHost.mockReset();
    roomApi.restoreRoomSession.mockReset().mockResolvedValue(null);
  });
  it('provides a way home while the room is loading and after joining is required', async () => {
    render(<RoomPage roomCode="AB12CD34" />);
    expect(screen.getByRole('link', { name: /back to home/i })).toHaveAttribute('href', '/');
    expect(await screen.findByRole('heading', { name: 'Join this room' })).toBeVisible();
    expect(screen.getByRole('link', { name: /back to home/i })).toHaveAttribute('href', '/');
  });

  it('provides a way home when room lookup fails', async () => {
    roomApi.restoreRoomSession.mockRejectedValueOnce(new Error('Room not found'));
    render(<RoomPage roomCode="AB12CD34" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Room not found');
    expect(screen.getByRole('link', { name: /back to home/i })).toHaveAttribute('href', '/');
  });

  it('provides a way home from an active table', () => {
    render(<RoomPage roomCode="AB12CD34" initialSnapshot={votingSnapshot()} />);
    expect(screen.getByRole('link', { name: /back to home/i })).toHaveAttribute('href', '/');
  });

  it('renders every Fibonacci card', () => {
    render(<CardDeck cards={FIBONACCI_CARDS} selected={null} disabled={false} onSelect={vi.fn()} />);
    expect(screen.getAllByRole('button')).toHaveLength(FIBONACCI_CARDS.length);
    expect(screen.getAllByTestId('card-button')).toHaveLength(FIBONACCI_CARDS.length);
  });

  it('marks a selected card without revealing another member vote', () => {
    render(<RoomPage roomCode="AB12CD34" initialSnapshot={votingSnapshot({ myVote: '5' })} />);
    expect(screen.getByRole('main')).toHaveAttribute('data-theme', 'arcade');
    expect(screen.getByRole('button', { name: /5/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText(/other member.*5/i)).not.toBeInTheDocument();
  });

  it('does not render voting controls for an observer', () => {
    render(<RoomPage roomCode="AB12CD34" initialSnapshot={votingSnapshot({
      members: [
        { id: 'member-host', nickname: 'Host', role: 'host', joinedAt: '2024-01-01T00:00:00.000Z', lastSeenAt: '2024-01-01T00:00:00.000Z', online: true, hasVoted: false, vote: null },
        { id: 'member-1', nickname: 'You', role: 'observer', joinedAt: '2024-01-01T00:00:00.000Z', lastSeenAt: '2024-01-01T00:00:00.000Z', online: true, hasVoted: false, vote: null },
      ],
      myMemberId: 'member-1',
    })} />);
    expect(screen.queryByRole('group', { name: /fibonacci cards/i })).not.toBeInTheDocument();
  });

  it('keeps only round status in the round board', () => {
    const { rerender } = render(<RoundBoard snapshot={votingSnapshot()} />);
    expect(screen.getByTestId('round-status')).toHaveTextContent(/waiting for votes/i);
    rerender(<RoundBoard snapshot={revealedSnapshot()} />);
    expect(screen.getByTestId('round-status')).toHaveTextContent(/revealed/i);
    expect(screen.queryByTestId('distribution-bars')).not.toBeInTheDocument();
  });

  it('places the round above the table and the voting deck before the member grid inside it', () => {
    const { container } = render(<RoomPage roomCode="AB12CD34" initialSnapshot={votingSnapshot()} />);
    const tablePanel = container.querySelector('.table-panel');
    const roundBoard = screen.getByTestId('round-board');
    const deck = screen.getByRole('group', { name: /fibonacci cards/i });
    const memberGrid = screen.getByTestId('member-grid');

    expect(tablePanel).not.toContainElement(roundBoard);
    expect(roundBoard.compareDocumentPosition(tablePanel!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tablePanel).toContainElement(deck);
    expect(tablePanel).toContainElement(memberGrid);
    expect(roundBoard.compareDocumentPosition(deck) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(deck.compareDocumentPosition(memberGrid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByTestId('member-rail')).not.toBeInTheDocument();
  });

  it('places the revealed distribution after the member grid inside the table', () => {
    const { container } = render(<RoomPage roomCode="AB12CD34" initialSnapshot={revealedSnapshot()} />);
    const tablePanel = container.querySelector('.table-panel');
    const memberGrid = screen.getByTestId('member-grid');
    const distribution = screen.getByRole('group', { name: 'Vote distribution' });

    expect(tablePanel).toContainElement(memberGrid);
    expect(tablePanel).toContainElement(distribution);
    expect(memberGrid.compareDocumentPosition(distribution) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('omits the distribution while votes remain hidden', () => {
    render(<RoomPage roomCode="AB12CD34" initialSnapshot={votingSnapshot()} />);

    expect(screen.queryByRole('group', { name: 'Vote distribution' })).not.toBeInTheDocument();
    expect(screen.getByTestId('member-grid')).toBeInTheDocument();
  });

  it('uses only the room name as the main title and places sharing and connection in the header', () => {
    const snapshot = { ...revealedSnapshot(), myMemberId: 'member-host' };
    const { container, rerender } = render(<RoomPage roomCode={snapshot.room.code} initialSnapshot={snapshot} />);

    const header = container.querySelector<HTMLElement>('.room-header')!;
    expect(within(header).getByRole('heading', { level: 1 })).toHaveTextContent(/^Planning Room$/);
    expect(within(header).getAllByText('Planning Room')).toHaveLength(1);
    expect(screen.queryByText(snapshot.room.code)).not.toBeInTheDocument();
    expect(screen.getByTestId('member-count')).toHaveTextContent('3');
    expect(within(header).getByTestId('connection-status')).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: 'Copy share link' })).toBeInTheDocument();
    expect(screen.getByLabelText(/final estimate/i)).toHaveAttribute('data-testid', 'final-estimate');

    rerender(<RoomPage roomCode={snapshot.room.code} initialSnapshot={votingSnapshot({ myMemberId: 'member-host' })} />);
    expect(screen.getByTestId('reveal-button')).toHaveClass('arcade-button');
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

    render(<RoomPage roomCode="AB12CD34" initialSnapshot={{ ...revealedSnapshot(), myMemberId: 'member-host' }} />);

    expect(screen.getByRole('group', { name: 'Vote distribution' })).toBeInTheDocument();
    expect(screen.getByLabelText(/final estimate/i)).toHaveValue('5');
    expect(screen.getByTestId('final-estimate-value')).toHaveTextContent('Final estimate: 5');
    expect(screen.getByRole('img', { name: '5 votes: 2' })).toBeInTheDocument();

    Object.defineProperty(window, 'matchMedia', { writable: true, value: originalMatchMedia });
  });

  it('renders host controls only for the host role', () => {
    render(<RoomPage roomCode="AB12CD34" initialSnapshot={votingSnapshot({
      members: [
        { id: 'member-host', nickname: 'Host', role: 'host', joinedAt: '2024-01-01T00:00:00.000Z', lastSeenAt: '2024-01-01T00:00:00.000Z', online: true, hasVoted: false, vote: null },
        { id: 'member-1', nickname: 'You', role: 'voter', joinedAt: '2024-01-01T00:00:00.000Z', lastSeenAt: '2024-01-01T00:00:00.000Z', online: true, hasVoted: false, vote: null },
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
        onSaveOutcome={vi.fn()}
        onNextRound={vi.fn()}
        outcomeError={null}
        onTransferHost={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /reveal/i })).toBeDisabled();
  });

  it('disables every host mutation while the room is reconnecting', () => {
    const state = votingSnapshot({ myMemberId: 'member-host' });
    const controls = {
      onReveal: vi.fn(),
      onSaveOutcome: vi.fn(),
      onNextRound: vi.fn(),
      outcomeError: null,
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
    expect(screen.getByRole('button', { name: /next round/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /transfer host/i })).toBeEnabled();
    expect(screen.getByRole('combobox', { name: /transfer host/i })).toBeEnabled();

    rerender(<HostControls state={revealed} status="reconnecting" {...controls} />);
    expect(screen.getByRole('button', { name: /next round/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /transfer host/i })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: /transfer host/i })).toBeDisabled();

    const archived = votingSnapshot({
      myMemberId: 'member-host',
      round: {
        id: 'round-1',
        number: 1,
        status: 'archived',
        finalEstimate: '5',
        note: null,
        startedAt: '2024-01-01T00:00:00.000Z',
        revealedAt: '2024-01-01T00:05:00.000Z',
        archivedAt: '2024-01-01T00:06:00.000Z',
      },
    });
    rerender(<HostControls state={archived} status="connected" {...controls} />);
    expect(screen.queryByRole('button', { name: /next round/i })).not.toBeInTheDocument();

    rerender(<HostControls state={archived} status="reconnecting" {...controls} />);
    expect(screen.queryByRole('button', { name: /next round/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /transfer host/i })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: /transfer host/i })).toBeDisabled();
  });

  it('blocks voting while the room is reconnecting', async () => {
    roomSyncState.status = 'reconnecting';
    roomApi.submitVote.mockResolvedValueOnce(votingSnapshot({ myVote: '5' }));
    render(<RoomPage roomCode="AB12CD34" initialSnapshot={votingSnapshot()} />);

    await waitFor(() => expect(screen.getByText(/actions are unavailable/i)).toBeInTheDocument());
    screen.getByRole('button', { name: /5/i }).click();

    expect(roomApi.submitVote).not.toHaveBeenCalled();
  });

  it('allows the host to vote and reports a failed vote without marking it submitted', async () => {
    const hostState = votingSnapshot({ myMemberId: 'member-host' });
    roomApi.submitVote.mockRejectedValueOnce(new Error('Vote was not saved. Check your connection and retry.'));
    render(<RoomPage roomCode="AB12CD34" initialSnapshot={hostState} />);

    await userEvent.click(await screen.findByRole('button', { name: /5/i }));

    expect(roomApi.submitVote).toHaveBeenCalledWith('room-1', 'round-1', '5');
    expect(await screen.findByText('Vote was not saved. Check your connection and retry.')).toBeInTheDocument();
    expect(screen.getByTestId('member-card-member-host')).toHaveAttribute('data-vote-status', 'pending');
  });

  it('shows a saved current-round Note to room members who are not the host', () => {
    const memberSnapshot = revealedSnapshot();
    memberSnapshot.round.note = 'Keep the scope small';
    render(<RoomPage roomCode="AB12CD34" initialSnapshot={memberSnapshot} />);

    expect(screen.getByTestId('current-round-note')).toHaveTextContent('Note: Keep the scope small');
    expect(screen.queryByRole('textbox', { name: 'Note' })).not.toBeInTheDocument();
  });

  it('sends the latest outcome to one atomic next-round action and keeps archived history visible', async () => {
    const user = userEvent.setup();
    const current = { ...revealedSnapshot(), myMemberId: 'member-host' };
    const next = votingSnapshot({
      myMemberId: 'member-host',
      round: { id: 'round-2', number: 2, status: 'voting', finalEstimate: null, note: null, startedAt: '2026-10-08T12:06:00.000Z', revealedAt: null, archivedAt: null },
      recentRounds: [{
        id: 'round-1', number: 1, status: 'archived', finalEstimate: '8', note: 'Ship safely',
        startedAt: current.round.startedAt, revealedAt: current.round.revealedAt, archivedAt: '2026-10-08T12:06:00.000Z',
        distribution: current.distribution!,
      }],
    });
    roomApi.completeRoundAndStartNextRound.mockResolvedValueOnce(next);
    render(<RoomPage roomCode="AB12CD34" initialSnapshot={current} />);

    expect(screen.queryByRole('button', { name: /archive/i })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Final estimate' }), { target: { value: '8' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: 'Ship safely' } });
    await user.click(screen.getByRole('button', { name: 'Next round' }));

    await waitFor(() => expect(roomApi.completeRoundAndStartNextRound).toHaveBeenCalledWith('room-1', 'round-1', '8', 'Ship safely'));
    expect(await screen.findByText('Round 2')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Round history' })).toHaveTextContent('Final estimate: 8');
    expect(screen.getByRole('region', { name: 'Round history' })).toHaveTextContent('Ship safely');
  });

  it('keeps the revealed outcome draft visible when saving or advancing fails', async () => {
    const current = { ...revealedSnapshot(), myMemberId: 'member-host' };
    roomApi.updateRoundOutcome.mockRejectedValueOnce(new Error('Outcome save failed'));
    roomApi.completeRoundAndStartNextRound.mockRejectedValueOnce(new Error('Next round failed'));
    render(<RoomPage roomCode="AB12CD34" initialSnapshot={current} />);

    const estimate = screen.getByRole('textbox', { name: 'Final estimate' });
    const note = screen.getByRole('textbox', { name: 'Note' });
    fireEvent.change(estimate, { target: { value: '8' } });
    fireEvent.change(note, { target: { value: 'Keep this draft' } });
    await act(async () => { fireEvent.blur(note); });

    expect(await screen.findByRole('alert')).toHaveTextContent('Outcome save failed');
    expect(screen.getByRole('textbox', { name: 'Final estimate' })).toHaveValue('8');
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('Keep this draft');

    fireEvent.click(screen.getByRole('button', { name: 'Next round' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Next round failed');
    expect(screen.getByTestId('round-status')).toHaveTextContent(/revealed/i);
    expect(screen.getByRole('textbox', { name: 'Final estimate' })).toHaveValue('8');
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('Keep this draft');
  });

  it.each(['resolve', 'reject'] as const)('freezes drafts during a delayed save and permits latest Next after %s', async (result) => {
    const user = userEvent.setup();
    const current = { ...revealedSnapshot(), myMemberId: 'member-host' };
    let resolve!: (value: RoomSnapshot) => void;
    let reject!: (reason: Error) => void;
    roomApi.updateRoundOutcome.mockReturnValueOnce(new Promise<RoomSnapshot>((res, rej) => {
      resolve = res;
      reject = rej;
    }));
    let rejectNext!: (reason: Error) => void;
    roomApi.completeRoundAndStartNextRound.mockReturnValueOnce(new Promise<RoomSnapshot>((_res, rej) => { rejectNext = rej; }));
    render(<RoomPage roomCode="AB12CD34" initialSnapshot={current} />);

    fireEvent.change(screen.getByLabelText('Final estimate'), { target: { value: '8' } });
    const note = screen.getByRole('textbox', { name: 'Note' });
    await user.type(note, 'Saved draft');
    await user.click(screen.getByRole('heading', { name: 'Round outcome' }));

    expect(screen.getByLabelText('Final estimate')).toBeDisabled();
    expect(note).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next round' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Transfer host' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Transfer host' })).toBeDisabled();
    await user.type(note, ' ignored while saving');
    await user.click(screen.getByRole('button', { name: 'Next round' }));
    expect(note).toHaveValue('Saved draft');
    expect(roomApi.completeRoundAndStartNextRound).not.toHaveBeenCalled();

    await act(async () => {
      if (result === 'resolve') resolve({ ...current, round: { ...current.round, finalEstimate: '8', note: 'Saved draft' } });
      else reject(new Error('Save failed; draft not persisted'));
    });
    expect(note).toHaveValue('Saved draft');
    expect(note).toBeEnabled();
    if (result === 'reject') expect(screen.getByRole('alert')).toHaveTextContent('draft not persisted');

    await user.clear(note);
    await user.type(note, 'Latest unsaved draft');
    await user.dblClick(screen.getByRole('button', { name: 'Next round' }));
    expect(roomApi.updateRoundOutcome).toHaveBeenCalledTimes(1);
    expect(roomApi.completeRoundAndStartNextRound).toHaveBeenCalledTimes(1);
    expect(roomApi.completeRoundAndStartNextRound).toHaveBeenCalledWith('room-1', 'round-1', '8', 'Latest unsaved draft');
    expect(note).toBeDisabled();
    await act(async () => { rejectNext(new Error('Next failed; retry safely')); });
    expect(note).toHaveValue('Latest unsaved draft');
    expect(screen.getByRole('alert')).toHaveTextContent('Next failed');
    expect(screen.getByTestId('round-status')).toHaveTextContent(/revealed/i);
    expect(screen.getByRole('button', { name: 'Next round' })).toBeEnabled();
  });

  it.each(['vote', 'reveal', 'transfer'] as const)('disables the deck and all host controls during a delayed %s', async (action) => {
    const user = userEvent.setup();
    const current = votingSnapshot({ myMemberId: 'member-host' });
    let reject!: (reason: Error) => void;
    const pending = new Promise<RoomSnapshot>((_res, rej) => { reject = rej; });
    roomApi.submitVote.mockReturnValueOnce(pending);
    roomApi.revealRound.mockReturnValueOnce(pending);
    roomApi.transferHost.mockReturnValueOnce(pending);
    render(<RoomPage roomCode="AB12CD34" initialSnapshot={current} />);

    if (action === 'vote') await user.click(screen.getByRole('button', { name: '5' }));
    else if (action === 'reveal') await user.click(screen.getByRole('button', { name: 'Reveal' }));
    else {
      await user.selectOptions(screen.getByRole('combobox', { name: 'Transfer host' }), 'member-1');
      await user.click(screen.getByRole('button', { name: 'Transfer host' }));
    }
    expect(screen.getByRole('button', { name: 'Reveal' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Transfer host' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Transfer host' })).toBeDisabled();
    for (const card of screen.getAllByTestId('card-button')) expect(card).toBeDisabled();
    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true');
    await act(async () => { reject(new Error('Action failed')); });
    expect(screen.getByRole('button', { name: 'Reveal' })).toBeEnabled();
    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'false');
  });

  it('freezes the outcome while host transfer is pending', async () => {
    let reject!: (reason: Error) => void;
    roomApi.transferHost.mockReturnValueOnce(new Promise<RoomSnapshot>((_res, rej) => { reject = rej; }));
    render(<RoomPage roomCode="AB12CD34" initialSnapshot={{ ...revealedSnapshot(), myMemberId: 'member-host' }} />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Transfer host' }), 'member-1');
    await userEvent.click(screen.getByRole('button', { name: 'Transfer host' }));
    expect(screen.getByLabelText('Final estimate')).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Note' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next round' })).toBeDisabled();
    await act(async () => { reject(new Error('Transfer failed')); });
    expect(screen.getByLabelText('Final estimate')).toBeEnabled();
  });

  it('requires explicit identity before joining a deep-linked room', async () => {
    window.localStorage.clear();
    render(<RoomPage roomCode="AB12CD34" />);

    expect(await screen.findByText(/join this room/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/nickname/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/room code/i)).toHaveValue('AB12CD34');
    expect(roomApi.joinRoom).not.toHaveBeenCalled();
  });

  it('restores membership by room code without trusting cached member identity', async () => {
    window.localStorage.clear();
    const snapshot = votingSnapshot();
    roomApi.restoreRoomSession.mockResolvedValueOnce(snapshot);
    saveRecentRoom(snapshot);

    render(<RoomPage roomCode={snapshot.room.code} />);

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(snapshot.room.name);
    expect(roomApi.restoreRoomSession).toHaveBeenCalledWith(snapshot.room.code);
    expect(roomApi.joinRoom).not.toHaveBeenCalled();
  });

  it('restores a room even when it is missing from recent history', async () => {
    window.localStorage.clear();
    roomApi.restoreRoomSession.mockResolvedValueOnce(votingSnapshot({ myVote: '5' }));

    render(<RoomPage roomCode="AB12CD34" />);

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Planning Room');
    expect(screen.getByRole('button', { name: '5 selected' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('heading', { name: 'Join this room' })).not.toBeInTheDocument();
  });

  it('shows lookup failures even when there is no recent history', async () => {
    window.localStorage.clear();
    roomApi.restoreRoomSession.mockRejectedValueOnce(new Error('Failed to fetch'));

    render(<RoomPage roomCode="AB12CD34" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to fetch');
    expect(screen.queryByRole('heading', { name: 'Join this room' })).not.toBeInTheDocument();
  });

  it('offers explicit rejoining when recent history does not belong to the current session', async () => {
    window.localStorage.clear();
    saveRecentRoom(votingSnapshot());
    roomApi.restoreRoomSession.mockResolvedValueOnce(null);
    const joinedSnapshot = votingSnapshot({
      myMemberId: 'member-2',
      members: votingSnapshot().members.map((member) => member.id === 'member-2'
        ? { ...member, nickname: 'New participant', role: 'observer' as const }
        : member),
    });
    roomApi.joinRoom.mockResolvedValueOnce(joinedSnapshot);

    render(<RoomPage roomCode="AB12CD34" />);

    expect(await screen.findByRole('heading', { name: 'Join this room' })).toBeInTheDocument();
    expect(screen.getByText(/previous room session.*join again/i)).toBeInTheDocument();
    expect(screen.queryByText('Loading room…')).not.toBeInTheDocument();
    expect(screen.queryByText('Connection error')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Nickname')).toHaveValue('');
    expect(roomApi.joinRoom).not.toHaveBeenCalled();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Nickname'), 'New participant');
    await user.click(screen.getByRole('radio', { name: 'Observer' }));
    await user.click(screen.getByRole('button', { name: /^Join$/ }));

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Planning Room');
    expect(roomApi.joinRoom).toHaveBeenCalledWith('AB12CD34', 'New participant', 'observer');
    expect(screen.queryByRole('group', { name: /fibonacci cards/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/previous room session/i)).not.toBeInTheDocument();
  });

  it('keeps genuine recovery failures visible instead of treating them as a missing membership', async () => {
    window.localStorage.clear();
    saveRecentRoom(votingSnapshot());
    roomApi.restoreRoomSession.mockRejectedValueOnce(new Error('Failed to fetch'));

    render(<RoomPage roomCode="AB12CD34" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to fetch');
    expect(screen.getByText('Connection error')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Join this room' })).not.toBeInTheDocument();
    expect(screen.queryByText('Loading room…')).not.toBeInTheDocument();
    expect(roomApi.joinRoom).not.toHaveBeenCalled();
  });
});

vi.mock('../../lib/roomSync', () => ({
  subscribeToRoom: vi.fn((_roomId, handlers) => {
    handlers.onConnectionChange(roomSyncState.status);
    return { unsubscribe: vi.fn(), sendVoteAnimation: vi.fn().mockResolvedValue(undefined) };
  }),
  fetchRoomSnapshot: vi.fn(),
}));
