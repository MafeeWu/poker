import type { VoteValue } from '../domain/poker';

export type CardProps = {
  value: VoteValue;
  selected: boolean;
  faceDown: boolean;
  disabled: boolean;
  onClick: () => void;
};

export function Card({ value, selected, faceDown, disabled, onClick }: CardProps) {
  const labels: Record<VoteValue, string> = {
    '0': '0',
    '½': 'half',
    '1': '1',
    '2': '2',
    '3': '3',
    '5': '5',
    '8': '8',
    '13': '13',
    '21': '21',
    '34': '34',
    '55': 'fifty five',
    '∞': 'infinity',
    '?': 'question mark',
  };

  const label = `${labels[value]}${selected ? ' selected' : ''}${disabled ? ' disabled' : ''}`.trim();

  return (
    <button
      type="button"
      className={`card-button${selected ? ' selected' : ''}${faceDown ? ' is-face-down' : ''}`}
      data-testid="card-button"
      aria-label={label}
      aria-pressed={selected}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={onClick}
      style={{ ['--reveal-index' as string]: String(value.length) }}
    >
      <span className="card-inner" aria-hidden="true">
        <span className="card-face card-back">♣</span>
        <span className="card-face card-front">
          <span className="card-rank">{value}</span>
        </span>
      </span>
      <span className="sr-only">{label}</span>
    </button>
  );
}
