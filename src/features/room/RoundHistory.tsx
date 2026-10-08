import type { ArchivedRoundRecord } from '../../lib/roomApi';

type RoundHistoryProps = {
  rounds: ArchivedRoundRecord[];
};

export function RoundHistory({ rounds }: RoundHistoryProps) {
  return (
    <section className="round-history" aria-label="Round history">
      <h2>Round history</h2>
      {rounds.length > 0 ? (
        <ol>
          {rounds.map((round) => (
            <li key={round.id}>
              <h3>Round {round.number}</h3>
              <p>Final estimate: {round.finalEstimate ?? 'Not set'}</p>
              {round.note !== null ? <p>Note: {round.note}</p> : null}
            </li>
          ))}
        </ol>
      ) : <p>No archived rounds yet.</p>}
    </section>
  );
}
