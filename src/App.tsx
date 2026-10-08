import { AppRouter } from './app/AppRouter';
import { SupabaseConfigNotice } from './components/SupabaseConfigNotice';
import { getSupabaseConfigError } from './lib/supabase';

export function App() {
  const configError = getSupabaseConfigError();
  if (configError) {
    return <SupabaseConfigNotice message={configError} />;
  }

  return <AppRouter />;
}
