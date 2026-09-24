import type { RoomSnapshot } from '../../lib/roomApi';

export function RoundBoard({ snapshot }: { snapshot: RoomSnapshot }) {
  if (snapshot.round.status === 'voting') {
    return (
      <section>
        <h2>Round {snapshot.round.number}</h2>
        <p>Waiting for votes…</p>
      </section>
    );
  }

  const distribution = snapshot.distribution ?? {};
  const values = Object.entries(distribution) as Array<[string, number]>;
  const maxValue = Math.max(1, ...values.map(([, count]) => count));

  return (
    <section>
      <h2>Round {snapshot.round.number}</h2>
      <svg role="img" aria-label="Vote distribution" viewBox="0 0 220 120" width="220" height="120">
        {values.map(([value, count], index) => {
          const barHeight = (count / maxValue) * 80;
          const x = index * 14 + 8;
          const y = 100 - barHeight;
          return (
            <g key={value}>
              <rect x={x} y={y} width={10} height={barHeight} fill="currentColor" />
              <text x={x + 5} y={112} fontSize="8" textAnchor="middle">{value}</text>
            </g>
          );
        })}
      </svg>
      {snapshot.round.finalEstimate ? <p>Final estimate: {snapshot.round.finalEstimate}</p> : null}
    </section>
  );
}
