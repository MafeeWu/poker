export function AppRouter() {
  const pathname = window.location.pathname;
  const roomMatch = pathname.match(/^\/room\/([^/]+)$/);

  if (roomMatch) {
    return (
      <main>
        <h1>Poker Room</h1>
        <p>Room {roomMatch[1]}</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Poker</h1>
    </main>
  );
}
