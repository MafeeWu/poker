import { FIBONACCI_CARDS, type VoteDistribution as VoteDistributionData } from '../../domain/poker';

type VoteDistributionProps = {
  distribution: VoteDistributionData | null;
};

export function VoteDistribution({ distribution }: VoteDistributionProps) {
  if (!distribution) {
    return null;
  }

  const values = FIBONACCI_CARDS.map((card) => [card, distribution[card]] as const).filter(([, count]) => count > 0);
  if (values.length === 0) {
    return null;
  }

  const maxValue = Math.max(...values.map(([, count]) => count));

  return (
    <section className="vote-distribution" aria-label="Vote distribution">
      <div className="distribution-chart" role="group" aria-label="Vote distribution" data-testid="distribution-bars">
        {values.map(([value, count]) => {
          const barHeight = Math.max(10, (count / maxValue) * 100);
          return (
            <div key={value} className="distribution-bar-wrap">
              <span
                className="distribution-bar"
                style={{ height: barHeight + '%' }}
                role="img"
                aria-label={value + ' votes: ' + count}
              />
              <span className="distribution-label">{value}</span>
              <span className="distribution-count">{count}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
