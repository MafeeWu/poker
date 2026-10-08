import type { RoomSnapshot } from '../../lib/roomApi';

export function RoundBoard({ snapshot }: { snapshot: RoomSnapshot }) {
  if (snapshot.round.status === 'voting') {
    return (
      <section className="round-board" aria-live="polite" data-testid="round-board">
        <div className="round-title">
          <h2>Round {snapshot.round.number}</h2>
        </div>
        <p className="round-status" data-testid="round-status">Waiting for votes…</p>
      </section>
    );
  }

  return (
    <section className="round-board" aria-live="polite" data-testid="round-board">
      <div className="round-title">
        <h2>Round {snapshot.round.number}</h2>
        <span className="status-pill tone-success" data-testid="round-status">Revealed</span>
      </div>
    </section>
  );
}
