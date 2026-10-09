import { render, screen } from '@testing-library/react';
import { HomePage } from './HomePage';
import userEvent from '@testing-library/user-event';

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
});
