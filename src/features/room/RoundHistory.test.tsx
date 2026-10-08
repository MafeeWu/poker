import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ArchivedRoundRecord } from '../../lib/roomApi';
import { RoundHistory } from './RoundHistory';

const rounds: ArchivedRoundRecord[] = [
  {
    id: 'round-3',
    number: 3,
    status: 'archived',
    finalEstimate: '8',
    note: 'Most recent note',
    startedAt: '2026-10-08T12:00:00.000Z',
    revealedAt: '2026-10-08T12:05:00.000Z',
    archivedAt: '2026-10-08T12:06:00.000Z',
    distribution: { '0': 0, '½': 0, '1': 0, '2': 0, '3': 0, '5': 0, '8': 1, '13': 0, '21': 0, '34': 0, '55': 0, '∞': 0, '?': 0 },
  },
  {
    id: 'round-2',
    number: 2,
    status: 'archived',
    finalEstimate: '5',
    note: null,
    startedAt: '2026-10-08T11:00:00.000Z',
    revealedAt: '2026-10-08T11:05:00.000Z',
    archivedAt: '2026-10-08T11:06:00.000Z',
    distribution: { '0': 0, '½': 0, '1': 0, '2': 0, '3': 0, '5': 1, '8': 0, '13': 0, '21': 0, '34': 0, '55': 0, '∞': 0, '?': 0 },
  },
];

describe('RoundHistory', () => {
  it('shows archived rounds newest-first with saved estimates and Notes', () => {
    render(<RoundHistory rounds={rounds} />);
    const history = screen.getByRole('region', { name: 'Round history' });
    const items = within(history).getAllByRole('listitem');

    expect(items[0]).toHaveTextContent('Round 3');
    expect(items[0]).toHaveTextContent('Final estimate: 8');
    expect(items[0]).toHaveTextContent('Most recent note');
    expect(items[1]).toHaveTextContent('Round 2');
    expect(items[1]).toHaveTextContent('Final estimate: 5');
    expect(items[1]).not.toHaveTextContent('Note:');
    expect(history).not.toHaveTextContent('unsaved');
  });

  it('renders an empty state when there are no archived rounds', () => {
    render(<RoundHistory rounds={[]} />);

    expect(screen.getByText('No archived rounds yet.')).toBeInTheDocument();
  });
});
