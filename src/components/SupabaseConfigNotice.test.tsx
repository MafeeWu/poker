import { render, screen } from '@testing-library/react';
import { SupabaseConfigNotice } from './SupabaseConfigNotice';

it('visibly explains missing Supabase configuration instead of failing during route startup', () => {
  render(<SupabaseConfigNotice message="Missing Supabase configuration: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY." />);

  expect(screen.getByRole('alert')).toHaveTextContent(/missing supabase configuration/i);
  expect(screen.getByRole('heading', { name: /supabase configuration required/i })).toBeVisible();
  expect(screen.getByText(/start local supabase/i)).toBeVisible();
});
