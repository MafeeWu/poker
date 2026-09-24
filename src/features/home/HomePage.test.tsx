import { render, screen } from '@testing-library/react';
import { HomePage } from './HomePage';

describe('HomePage', () => {
  it('shows create and join entry points', () => {
    render(<HomePage />);
    expect(screen.getByRole('button', { name: /create project/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /join project/i })).toBeInTheDocument();
  });
});
