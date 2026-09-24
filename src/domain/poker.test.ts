import { describe, expect, it } from 'vitest';
import { FIBONACCI_CARDS, calculateDistribution, emptyDistribution } from './poker';

describe('poker card deck', () => {
  it('keeps the Fibonacci deck order', () => {
    expect(FIBONACCI_CARDS).toEqual([
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
    ]);
  });

  it('starts every card at zero', () => {
    expect(emptyDistribution()).toMatchObject({
      '0': 0,
      '½': 0,
      '1': 0,
      '2': 0,
      '3': 0,
      '5': 0,
      '8': 0,
      '13': 0,
      '21': 0,
      '34': 0,
      '55': 0,
      '∞': 0,
      '?': 0,
    });
  });

  it('counts each revealed vote without calculating an average', () => {
    expect(calculateDistribution(['3', '5', '5', '?'])).toMatchObject({ '3': 1, '5': 2, '?': 1 });
  });

  it('counts mixed values including infinity and question marks', () => {
    expect(calculateDistribution(['0', '½', '1', '∞', '?', '∞'])).toMatchObject({
      '0': 1,
      '½': 1,
      '1': 1,
      '∞': 2,
      '?': 1,
    });
  });

  it('rejects invalid fibonacci cards', () => {
    expect(() => calculateDistribution(['9' as any])).toThrow('Invalid Fibonacci card');
  });
});
