import type { VoteValue } from '../domain/poker';

export type CardProps = {
  value: VoteValue;
  selected: boolean;
  faceDown: boolean;
  disabled: boolean;
  onClick: () => void;
};

const CARD_SUITS: Record<VoteValue, { symbol: string; tone: 'black' | 'red' | 'wild' }> = {
  '0': { symbol: '♣', tone: 'black' },
  '½': { symbol: '♦', tone: 'red' },
  '1': { symbol: '♠', tone: 'black' },
  '2': { symbol: '♥', tone: 'red' },
  '3': { symbol: '♣', tone: 'black' },
  '5': { symbol: '♦', tone: 'red' },
  '8': { symbol: '♠', tone: 'black' },
  '13': { symbol: '♥', tone: 'red' },
  '21': { symbol: '♣', tone: 'black' },
  '34': { symbol: '♦', tone: 'red' },
  '55': { symbol: '♠', tone: 'black' },
  '∞': { symbol: '♥', tone: 'red' },
  '?': { symbol: '★', tone: 'wild' },
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
  const suit = CARD_SUITS[value];

  return (
    <button
      type="button"
      className={`card-button${selected ? ' selected' : ''}${faceDown ? ' is-face-down' : ''}`}
      data-suit-tone={suit.tone}
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
          <span className="card-corner card-corner-top">
            <span data-testid="card-suit">{suit.symbol}</span>
            <span>{value}</span>
          </span>
          <span className="card-rank">{value}</span>
          <span className="card-corner card-corner-bottom" aria-hidden="true">
            <span>{suit.symbol}</span>
            <span>{value}</span>
          </span>
        </span>
      </span>
      <span className="sr-only">{label}</span>
    </button>
  );
}
