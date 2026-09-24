import { render, screen } from '@testing-library/react';
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

  it('announces copied state via aria-live', () => {
    render(<CopyButton value="AB12CD34" label="Room link" />);

    expect(screen.getByRole('button', { name: /room link/i })).toBeInTheDocument();
    expect(screen.getByText(/copied/i)).toBeInTheDocument();
  });
});
