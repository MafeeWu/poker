import { useEffect, useState, type FocusEvent } from 'react';
import type { EstimateSuggestion } from '../../domain/roundOutcome';

export type RoundOutcomeFormProps = {
  roundId: string;
  finalEstimate: string | null;
  note: string | null;
  suggestion: EstimateSuggestion;
  pendingAction: 'save' | 'next' | null;
  disabled: boolean;
  error: string | null;
  onSave: (finalEstimate: string | null, note: string | null) => void;
  onNextRound: (finalEstimate: string, note: string | null) => void;
};

function initialEstimate(finalEstimate: string | null, suggestion: EstimateSuggestion): string {
  if (finalEstimate !== null) {
    return finalEstimate;
  }
  return suggestion.kind === 'unique' ? suggestion.value : '';
}

export function RoundOutcomeForm({
  roundId,
  finalEstimate,
  note,
  suggestion,
  pendingAction,
  disabled,
  error,
  onSave,
  onNextRound,
}: RoundOutcomeFormProps) {
  const [estimateDraft, setEstimateDraft] = useState(() => initialEstimate(finalEstimate, suggestion));
  const [noteDraft, setNoteDraft] = useState(note ?? '');
  const noteLength = Array.from(noteDraft).length;
  const noteIsOverLimit = noteLength > 240;
  const estimateIsMissing = !estimateDraft.trim();
  const isPending = pendingAction !== null;

  useEffect(() => {
    setEstimateDraft(initialEstimate(finalEstimate, suggestion));
    setNoteDraft(note ?? '');
  }, [roundId]);

  const saveDraft = () => {
    if (disabled || isPending || noteIsOverLimit) {
      return;
    }
    const normalizedEstimate = estimateDraft.trim() ? estimateDraft : null;
    const normalizedNote = noteDraft.trim() ? noteDraft : null;
    if (normalizedEstimate === finalEstimate && normalizedNote === note) {
      return;
    }
    onSave(normalizedEstimate, normalizedNote);
  };

  const handleDraftBlur = (event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.relatedTarget instanceof HTMLElement && event.relatedTarget.closest('[data-next-round]')) {
      return;
    }
    saveDraft();
  };

  const handleNextRound = () => {
    if (disabled || isPending || noteIsOverLimit || estimateIsMissing) {
      return;
    }
    onNextRound(estimateDraft.trim(), noteDraft.trim() ? noteDraft : null);
  };

  const estimateDisabled = disabled || isPending;

  return (
    <section className="round-outcome" aria-labelledby="round-outcome-heading">
      <h2 id="round-outcome-heading">Round outcome</h2>
      {suggestion.kind === 'tie' ? (
        <div className="estimate-suggestion" aria-label="Tied estimates">
          <p>Tied estimates: {suggestion.values.join(', ')}</p>
          <div className="estimate-suggestion-options">
            {suggestion.values.map((value) => (
              <button
                key={value}
                type="button"
                className="arcade-button"
                aria-pressed={estimateDraft === value}
                onClick={() => setEstimateDraft(value)}
                disabled={estimateDisabled}
              >
                Use estimate {value}
              </button>
            ))}
          </div>
        </div>
      ) : suggestion.kind === 'no-votes' ? (
        <p>No votes were submitted. Enter a final estimate to continue.</p>
      ) : null}
      <label>
        Final estimate
        <input
          type="text"
          data-testid="final-estimate"
          value={estimateDraft}
          onChange={(event) => setEstimateDraft(event.target.value)}
          onBlur={handleDraftBlur}
          disabled={estimateDisabled}
        />
      </label>
      <label>
        Note
        <textarea
          value={noteDraft}
          onChange={(event) => setNoteDraft(event.target.value)}
          onBlur={handleDraftBlur}
          disabled={estimateDisabled}
          aria-describedby="round-note-count"
        />
      </label>
      <p id="round-note-count" className={noteIsOverLimit ? 'round-note-count is-invalid' : 'round-note-count'}>
        {noteLength}/240 characters
      </p>
      {noteIsOverLimit ? <p role="alert">Note must be 240 characters or fewer.</p> : null}
      {estimateIsMissing ? <p role="status">Enter a final estimate before starting the next round.</p> : null}
      {pendingAction === 'save' ? <p role="status">Saving outcome…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <button
        type="button"
        className="arcade-button"
        onClick={handleNextRound}
        data-next-round
        disabled={disabled || isPending || noteIsOverLimit || estimateIsMissing}
      >
        {pendingAction === 'next' ? 'Starting next round…' : 'Next round'}
      </button>
    </section>
  );
}
