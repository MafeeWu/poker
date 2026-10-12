import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { createRoom, joinRoom, type RoomSnapshot } from '../../lib/roomApi';
import { RoomEntryForm } from './RoomEntryForm';

vi.mock('../../lib/roomApi', () => ({
  joinRoom: vi.fn(),
  createRoom: vi.fn(),
}));

const snapshot: RoomSnapshot = {
  room: { id: 'room-1', code: 'AB12CD34', name: 'Sprint', hostMemberId: 'member-1', maxMembers: 100, createdAt: '2024-01-01T00:00:00.000Z' },
  myMemberId: 'member-1',
  members: [{
    id: 'member-1', nickname: 'Mina', role: 'host', joinedAt: '2024-01-01T00:00:00.000Z',
    lastSeenAt: '2024-01-01T00:00:00.000Z', online: true, hasVoted: false, vote: null,
  }],
  round: {
    id: 'round-1', number: 1, status: 'voting', finalEstimate: null, note: null,
    startedAt: '2024-01-01T00:00:00.000Z', revealedAt: null, archivedAt: null,
  },
  myVote: null,
  submittedCount: 0,
  distribution: null,
  recentRounds: [],
};

describe('RoomEntryForm', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('requires a nickname before creating a room', async () => {
    render(<RoomEntryForm mode="create" onSuccess={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /create/i }));
    expect(screen.getByText(/nickname is required/i)).toBeInTheDocument();
  });

  it('requires an eight-character room code before joining', async () => {
    render(<RoomEntryForm mode="join" onSuccess={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/nickname/i), 'Mina');
    await userEvent.click(screen.getByRole('button', { name: /join/i }));
    expect(screen.getByText(/8-character room code is required/i)).toBeInTheDocument();
  });

  it('shows a server error without clearing the entered nickname', async () => {
    vi.mocked(joinRoom).mockRejectedValueOnce(new Error('Room is full'));
    render(<RoomEntryForm mode="join" onSuccess={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/nickname/i), 'Mina');
    await userEvent.type(screen.getByLabelText(/room code/i), 'AB12CD34');
    await userEvent.click(screen.getByRole('button', { name: /join/i }));
    expect(await screen.findByText('Room is full')).toBeInTheDocument();
    expect(screen.getByTestId('join-error')).toHaveTextContent('Room is full');
    expect(screen.getByLabelText(/nickname/i)).toHaveValue('Mina');
  });

  it.each(['create', 'join'] as const)('shows %s loading and prevents repeated submissions until success', async (mode) => {
    const user = userEvent.setup();
    let finish!: (value: RoomSnapshot) => void;
    const pending = new Promise<RoomSnapshot>((resolve) => { finish = resolve; });
    const operation = vi.mocked(mode === 'create' ? createRoom : joinRoom);
    operation.mockReturnValueOnce(pending);
    const onSuccess = vi.fn();
    const { container } = render(<RoomEntryForm mode={mode} onSuccess={onSuccess} />);
    await user.type(screen.getByLabelText('Nickname'), 'Mina');
    await user.type(screen.getByLabelText(mode === 'create' ? 'Project name' : 'Room code'), mode === 'create' ? 'Sprint' : 'AB12CD34');
    await user.click(screen.getByRole('button', { name: mode === 'create' ? 'Create' : 'Join' }));

    const button = screen.getByRole('button', { name: mode === 'create' ? 'Creating…' : 'Joining…' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button.querySelector('.button-spinner')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByLabelText('Nickname')).toBeDisabled();
    if (mode === 'join') expect(screen.getByRole('radio', { name: 'Observer' })).toBeDisabled();
    fireEvent.submit(container.querySelector('form')!);
    expect(operation).toHaveBeenCalledTimes(1);

    await act(async () => { finish(snapshot); });
    expect(onSuccess).toHaveBeenCalledExactlyOnceWith(snapshot);
    expect(screen.getByRole('button', { name: mode === 'create' ? 'Create' : 'Join' })).toBeEnabled();
    expect(screen.queryByText(/Creating…|Joining…/)).not.toBeInTheDocument();
  });

  it.each(['create', 'join'] as const)('restores %s controls and permits retry after failure', async (mode) => {
    const user = userEvent.setup();
    let fail!: (error: Error) => void;
    const operation = vi.mocked(mode === 'create' ? createRoom : joinRoom);
    operation.mockReturnValueOnce(new Promise<RoomSnapshot>((_, reject) => { fail = reject; }));
    operation.mockResolvedValueOnce(snapshot);
    const onSuccess = vi.fn();
    render(<RoomEntryForm mode={mode} onSuccess={onSuccess} />);
    await user.type(screen.getByLabelText('Nickname'), 'Mina');
    if (mode === 'join') await user.type(screen.getByLabelText('Room code'), 'AB12CD34');
    const buttonName = mode === 'create' ? 'Create' : 'Join';
    await user.click(screen.getByRole('button', { name: buttonName }));
    await act(async () => { fail(new Error('Network unavailable')); });

    expect(screen.getByRole('alert')).toHaveTextContent('Network unavailable');
    expect(screen.getByLabelText('Nickname')).toHaveValue('Mina');
    expect(screen.getByLabelText('Nickname')).toBeEnabled();
    expect(screen.getByRole('button', { name: buttonName })).toBeEnabled();
    expect(onSuccess).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: buttonName }));
    expect(onSuccess).toHaveBeenCalledExactlyOnceWith(snapshot);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
