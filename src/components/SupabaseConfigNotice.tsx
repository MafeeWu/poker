export function SupabaseConfigNotice({ message }: { message: string }) {
  return (
    <main role="alert">
      <h1>Supabase configuration required</h1>
      <p>{message}</p>
      <p>Start local Supabase and configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.</p>
    </main>
  );
}
