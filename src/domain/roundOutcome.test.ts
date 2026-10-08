import { describe, expect, it } from 'vitest';
import { emptyDistribution } from './poker';
import { suggestFinalEstimate } from './roundOutcome';

describe('suggestFinalEstimate', () => {
  it('returns the unique most-voted Fibonacci value', () => {
    const distribution = emptyDistribution();
    distribution['5'] = 3;
    distribution['8'] = 1;

    expect(suggestFinalEstimate(distribution)).toEqual({ kind: 'unique', value: '5' });
  });

  it('returns tied maximum values in Fibonacci deck order', () => {
    const distribution = emptyDistribution();
    distribution['?'] = 2;
    distribution['1'] = 2;
    distribution['5'] = 1;

    expect(suggestFinalEstimate(distribution)).toEqual({ kind: 'tie', values: ['1', '?'] });
  });

  it('returns no-votes for a missing or all-zero distribution', () => {
    expect(suggestFinalEstimate(null)).toEqual({ kind: 'no-votes' });
    expect(suggestFinalEstimate(emptyDistribution())).toEqual({ kind: 'no-votes' });
  });
});
