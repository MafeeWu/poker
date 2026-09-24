import type { VoteValue } from '../../domain/poker';
import { Card } from '../../components/Card';

export type CardDeckProps = {
  cards: readonly VoteValue[];
  selected: VoteValue | null;
  disabled: boolean;
  onSelect: (value: VoteValue) => void;
};

export function CardDeck({ cards, selected, disabled, onSelect }: CardDeckProps) {
  return (
    <div role="group" aria-label="Fibonacci cards" className="card-deck">
      {cards.map((card) => (
        <Card
          key={card}
          value={card}
          selected={selected === card}
          faceDown={false}
          disabled={disabled}
          onClick={() => onSelect(card)}
        />
      ))}
    </div>
  );
}
