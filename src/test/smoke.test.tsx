import { render, screen } from '@testing-library/react';
import { App } from '../App';

it('renders the Poker home heading', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: /poker/i })).toBeInTheDocument();
});
