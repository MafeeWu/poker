import { act, render, screen } from '@testing-library/react';
import { HomePage } from './HomePage';
import userEvent from '@testing-library/user-event';
import { createRoom, type RoomSnapshot } from '../../lib/roomApi';

vi.mock('../../lib/roomApi', () => ({
  createRoom: vi.fn(),
  joinRoom: vi.fn(),
}));

describe('HomePage', () => {
  it('uses the arcade visual theme', () => {
    render(<HomePage />);
    expect(screen.getByRole('main')).toHaveAttribute('data-theme', 'arcade');
    expect(screen.getByTestId('home-card-fan')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText(/lucky table/i)).toBeInTheDocument();
  });

  it('shows create and join entry points', () => {
    render(<HomePage />);
    expect(screen.getByRole('button', { name: /create project/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /join project/i })).toBeInTheDocument();
  });

  it('makes the active entry mode explicit to assistive technology', async () => {
    const user = userEvent.setup();
    render(<HomePage />);
    const create = screen.getByRole('button', { name: /create project/i });
    const join = screen.getByRole('button', { name: /join project/i });
    expect(create).toHaveAttribute('aria-pressed', 'true');
    expect(join).toHaveAttribute('aria-pressed', 'false');
    await user.click(join);
    expect(create).toHaveAttribute('aria-pressed', 'false');
    expect(join).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Room code')).toBeVisible();
  });

  it('uses the form controls expected by the end-to-end helpers', async () => {
    const user = userEvent.setup();
    render(<HomePage />);

    await user.type(screen.getByLabelText(/project name/i), 'Sprint 24');
    await user.type(screen.getByLabelText(/nickname/i), 'Host');
    await user.click(screen.getByRole('button', { name: /^join project$/i }));
    expect(screen.getByLabelText(/room code/i)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^voter$/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^observer$/i })).toBeInTheDocument();
  });

  it('prevents changing entry mode while a room submission is pending', async () => {
    const user = userEvent.setup();
    let fail!: (error: Error) => void;
    vi.mocked(createRoom).mockReturnValueOnce(new Promise<RoomSnapshot>((_, reject) => { fail = reject; }));
    render(<HomePage />);
    await user.type(screen.getByLabelText('Nickname'), 'Host');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(screen.getByRole('button', { name: 'Create project' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Join project' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Join project' }));
    expect(screen.getByLabelText('Project name')).toBeInTheDocument();
    await act(async () => { fail(new Error('Try again')); });
    expect(screen.getByRole('button', { name: 'Join project' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Join project' }));
    expect(screen.getByLabelText('Room code')).toBeInTheDocument();
  });
});
