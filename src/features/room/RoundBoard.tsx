import type { RoomSnapshot } from '../../lib/roomApi';

export function RoundBoard({ snapshot }: { snapshot: RoomSnapshot }) {
  if (snapshot.round.status === 'voting') {
    return (
      <section className="round-board" aria-live="polite">
        <div className="round-title">
          <h2>Round {snapshot.round.number}</h2>
        </div>
        <p className="round-status" data-testid="round-status">Waiting for votes…</p>
      </section>
    );
  }

  const distribution = snapshot.distribution ?? {};
  const values = Object.entries(distribution) as Array<[string, number]>;
  const maxValue = Math.max(1, ...values.map(([, count]) => count));

  return (
    <section className="round-board" aria-live="polite">
      <div className="round-title">
        <h2>Round {snapshot.round.number}</h2>
        <span className="status-pill tone-success" data-testid="round-status">Revealed</span>
      </div>

      <div role="img" aria-label="Vote distribution" className="vote-distribution" data-testid="distribution-bars">
        <div className="distribution-chart">
          {values.map(([value, count], index) => {
            const barHeight = Math.max(10, (count / maxValue) * 100);
            return (
              <div key={value} className="distribution-bar-wrap">
                <span
                  className="distribution-bar"
                  style={{ height: `${barHeight}%`, ['--bar-index' as string]: String(index) }}
                  aria-label={`${value} votes: ${count}`}
                />
                <span className="distribution-label">{value}</span>
              </div>
            );
          })}
        </div>
        <div className="distribution-summary" aria-label="Vote totals">
          {values.filter(([, count]) => count > 0).map(([value, count]) => (
            <span key={value}>{value}: {count}</span>
          ))}
        </div>
      </div>

      {snapshot.round.finalEstimate ? <p className="round-status" data-testid="final-estimate-value">Final estimate: {snapshot.round.finalEstimate}</p> : null}
    </section>
  );
}
