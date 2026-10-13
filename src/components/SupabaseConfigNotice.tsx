export function SupabaseConfigNotice({ message }: { message: string }) {
  return (
    <main className="state-shell" data-theme="arcade" role="alert">
      <section className="state-panel">
        <img className="state-joker" src="/joker.svg" alt="" />
        <p className="eyebrow">BEFORE WE DEAL THE CARDS</p>
        <h1>Supabase configuration required</h1>
        <p className="form-error">{message}</p>
        <p>Start local Supabase and configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.</p>
      </section>
    </main>
  );
}
