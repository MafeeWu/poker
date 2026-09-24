import { describe, expect, it } from 'vitest';
import { canPerformAction } from './roomState';

const base = {
  roundId: 'round-1',
  roundNumber: 1,
  selectedVote: null,
  distribution: null,
  finalEstimate: null,
} as const;

describe('room action permissions', () => {
  it.each([
    [{ ...base, status: 'voting', role: 'voter' }, { type: 'vote', value: '5' }, true],
    [{ ...base, status: 'voting', role: 'observer' }, { type: 'vote', value: '5' }, false],
    [{ ...base, status: 'voting', role: 'host' }, { type: 'reveal' }, true],
    [{ ...base, status: 'voting', role: 'voter' }, { type: 'reveal' }, false],
    [{ ...base, status: 'revealed', role: 'host' }, { type: 'archive', finalEstimate: '8' }, true],
    [{ ...base, status: 'revealed', role: 'host' }, { type: 'archive', finalEstimate: ' ' }, false],
    [{ ...base, status: 'archived', role: 'host' }, { type: 'start-next-round' }, true],
    [{ ...base, status: 'voting', role: 'host' }, { type: 'start-next-round' }, false],
  ] as const)('checks %o with %o', (state, action, expected) => {
    expect(canPerformAction(state as any, action as any)).toBe(expected);
  });
});
