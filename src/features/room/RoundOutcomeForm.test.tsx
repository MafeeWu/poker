import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { EstimateSuggestion } from '../../domain/roundOutcome';
import { RoundOutcomeForm } from './RoundOutcomeForm';

const unique: EstimateSuggestion = { kind: 'unique', value: '5' };
const tie: EstimateSuggestion = { kind: 'tie', values: ['1', '5'] };
const noVotes: EstimateSuggestion = { kind: 'no-votes' };

function renderForm(overrides: Partial<React.ComponentProps<typeof RoundOutcomeForm>> = {}) {
  const props = {
    roundId: 'round-1',
    finalEstimate: null,
    note: null,
    suggestion: unique,
    pendingAction: null,
    disabled: false,
    error: null,
    onSave: vi.fn(),
    onNextRound: vi.fn(),
    ...overrides,
  };
  return { ...render(<RoundOutcomeForm {...props} />), props };
}

describe('RoundOutcomeForm', () => {
  it('prefills a unique plurality estimate and keeps it editable', async () => {
    const user = userEvent.setup();
    renderForm();
    const estimate = screen.getByRole('textbox', { name: 'Final estimate' });

    expect(estimate).toHaveValue('5');
    await user.clear(estimate);
    await user.type(estimate, '8');
    expect(estimate).toHaveValue('8');
  });

  it('shows tied values and prevents advancing without an estimate', async () => {
    const user = userEvent.setup();
    renderForm({ suggestion: tie });

    expect(screen.getByText('Tied estimates: 1, 5')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next round' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Use estimate 1' }));
    expect(screen.getByRole('button', { name: 'Next round' })).toBeEnabled();
  });

  it('requires a manually entered estimate when there were no votes', async () => {
    const user = userEvent.setup();
    renderForm({ suggestion: noVotes });

    expect(screen.getByRole('button', { name: 'Next round' })).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: 'Final estimate' }), '13');
    expect(screen.getByRole('button', { name: 'Next round' })).toBeEnabled();
  });

  it('resets estimate and Note drafts when the round ID changes', () => {
    const { rerender, props } = renderForm();
    fireEvent.change(screen.getByRole('textbox', { name: 'Final estimate' }), { target: { value: '13' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: 'Draft from prior round' } });

    rerender(<RoundOutcomeForm {...props} roundId="round-2" finalEstimate="8" note="Saved next-round note" />);

    expect(screen.getByRole('textbox', { name: 'Final estimate' })).toHaveValue('8');
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('Saved next-round note');
  });

  it('reports an over-limit Unicode Note without truncating the draft', async () => {
    const user = userEvent.setup();
    renderForm();
    const note = screen.getByRole('textbox', { name: 'Note' });
    const draft = '🎴'.repeat(241);

    await user.type(note, draft);

    expect(note).toHaveValue(draft);
    expect(screen.getByText('241/240 characters')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('240 characters or fewer');
  });

  it('saves the latest draft on blur and retains it when a save error is returned', async () => {
    const { props, rerender } = renderForm();
    const estimate = screen.getByRole('textbox', { name: 'Final estimate' });
    const note = screen.getByRole('textbox', { name: 'Note' });

    fireEvent.change(estimate, { target: { value: '8' } });
    fireEvent.change(note, { target: { value: 'Investigate retries' } });
    fireEvent.blur(note);

    await waitFor(() => expect(props.onSave).toHaveBeenCalledWith('8', 'Investigate retries'));
    rerender(<RoundOutcomeForm {...props} finalEstimate="3" note="newer server note" error="Unable to save outcome" />);

    expect(screen.getByRole('textbox', { name: 'Final estimate' })).toHaveValue('8');
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('Investigate retries');
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to save outcome');
  });

  it('submits the latest estimate and Note and disables duplicate Next clicks while pending', async () => {
    const user = userEvent.setup();
    const onNextRound = vi.fn();
    const { rerender, props } = renderForm({ finalEstimate: '5', onNextRound });
    await user.clear(screen.getByRole('textbox', { name: 'Final estimate' }));
    await user.type(screen.getByRole('textbox', { name: 'Final estimate' }), '8');
    await user.type(screen.getByRole('textbox', { name: 'Note' }), 'Ship safely');
    await user.click(screen.getByRole('button', { name: 'Next round' }));

    expect(onNextRound).toHaveBeenCalledWith('8', 'Ship safely');
    rerender(<RoundOutcomeForm {...props} finalEstimate="5" pendingAction="next" />);
    expect(screen.getByRole('button', { name: /starting next round/i })).toBeDisabled();
  });
});
