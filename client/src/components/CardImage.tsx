import type { Card } from '@mtg/shared';

interface Props {
  card: Card;
  onClick?: () => void;
  disabled?: boolean;
  onHover?: (card: Card | null) => void;
}

export function CardImage({ card, onClick, disabled, onHover }: Props) {
  return (
    <button
      type="button"
      className="card"
      onClick={onClick}
      disabled={disabled}
      title={card.name}
      onMouseEnter={() => onHover?.(card)}
      onMouseLeave={() => onHover?.(null)}
    >
      {card.imageUrl ? (
        <img src={card.imageUrl} alt={card.name} loading="lazy" />
      ) : (
        <span className="card-fallback">{card.name}</span>
      )}
    </button>
  );
}
