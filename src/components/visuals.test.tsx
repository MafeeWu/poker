import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { Card } from './Card';
import { CopyButton } from './CopyButton';
import { InlineNotice } from './InlineNotice';
import { StatusPill } from './StatusPill';

describe('visual components', () => {
  it('exposes accessible names and selection state for cards', () => {
    render(<Card value="5" selected={true} faceDown={false} disabled={false} onClick={() => undefined} />);

    const card = screen.getByRole('button', { name: /5 selected/i });
    expect(card).toHaveAttribute('aria-pressed', 'true');
    expect(card).toBeInTheDocument();
    expect(screen.getByTestId('card-suit')).toHaveTextContent('♦');
  });

  it('renders labeled status pills and notices', () => {
    render(
      <>
        <StatusPill tone="success">Connected</StatusPill>
        <InlineNotice tone="info" title="Synced">Room state is current.</InlineNotice>
      </>,
    );

    expect(screen.getByText(/connected/i)).toBeInTheDocument();
    expect(screen.getByText(/synced/i)).toBeInTheDocument();
    expect(screen.getByText(/room state is current/i)).toBeInTheDocument();
  });

  it('shows accessible copy feedback only after copying succeeds', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(<CopyButton value="AB12CD34" label="Room link" />);

    expect(screen.getByRole('button', { name: /room link/i })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /room link/i }));

    expect(await screen.findByRole('status')).toHaveTextContent(/copied/i);
    expect(writeText).toHaveBeenCalledWith('AB12CD34');
  });

  it('shows visible error feedback when the browser rejects clipboard access', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('clipboard unavailable')) },
    });
    render(<CopyButton value="AB12CD34" label="Room link" />);

    await userEvent.click(screen.getByRole('button', { name: /room link/i }));

    expect(await screen.findByRole('status')).toHaveTextContent(/unable to copy link/i);
  });
});
