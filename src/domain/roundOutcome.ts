import { FIBONACCI_CARDS, type VoteDistribution, type VoteValue } from './poker';

export type EstimateSuggestion =
  | { kind: 'unique'; value: VoteValue }
  | { kind: 'tie'; values: VoteValue[] }
  | { kind: 'no-votes' };

export function suggestFinalEstimate(distribution: VoteDistribution | null): EstimateSuggestion {
  if (!distribution) {
    return { kind: 'no-votes' };
  }

  const maximum = Math.max(...FIBONACCI_CARDS.map((value) => distribution[value]));
  if (maximum <= 0) {
    return { kind: 'no-votes' };
  }

  const values = FIBONACCI_CARDS.filter((value) => distribution[value] === maximum);
  return values.length === 1
    ? { kind: 'unique', value: values[0] }
    : { kind: 'tie', values };
}
