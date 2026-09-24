export type VoteValue = '0' | '½' | '1' | '2' | '3' | '5' | '8' | '13' | '21' | '34' | '55' | '∞' | '?';

export const FIBONACCI_CARDS: readonly VoteValue[] = [
  '0',
  '½',
  '1',
  '2',
  '3',
  '5',
  '8',
  '13',
  '21',
  '34',
  '55',
  '∞',
  '?',
] as const;

export type VoteDistribution = Record<VoteValue, number>;

export function emptyDistribution(): VoteDistribution {
  return Object.fromEntries(FIBONACCI_CARDS.map((card) => [card, 0])) as VoteDistribution;
}

export function calculateDistribution(votes: readonly VoteValue[]): VoteDistribution {
  const validValues = new Set<VoteValue>(FIBONACCI_CARDS);
  const distribution = emptyDistribution();

  for (const vote of votes) {
    if (!validValues.has(vote)) {
      throw new Error('Invalid Fibonacci card');
    }

    distribution[vote] += 1;
  }

  return distribution;
}
