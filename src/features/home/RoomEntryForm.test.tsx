import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { joinRoom } from '../../lib/roomApi';
import { RoomEntryForm } from './RoomEntryForm';

vi.mock('../../lib/roomApi', () => ({
  joinRoom: vi.fn(),
  createRoom: vi.fn(),
}));

describe('RoomEntryForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(screen.getByLabelText(/nickname/i)).toHaveValue('Mina');
  });
});
