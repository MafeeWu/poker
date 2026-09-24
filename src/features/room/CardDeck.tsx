import type { VoteValue } from '../../domain/poker';

export type CardDeckProps = {
  cards: readonly VoteValue[];
  selected: VoteValue | null;
  disabled: boolean;
  onSelect: (value: VoteValue) => void;
};

export function CardDeck({ cards, selected, disabled, onSelect }: CardDeckProps) {
  const getAccessibleName = (card: VoteValue) => {
    if (card === '55') {
      return 'fifty five';
    }

    if (card === '∞') {
      return 'infinity';
    }

    if (card === '½') {
      return 'half';
    }

    return card;
  };

  return (
    <div role="group" aria-label="Fibonacci cards">
      {cards.map((card) => (
        <button
          key={card}
          type="button"
          aria-label={getAccessibleName(card)}
          aria-pressed={selected === card}
          disabled={disabled}
          onClick={() => onSelect(card)}
        >
          {card}
        </button>
      ))}
    </div>
  );
}
