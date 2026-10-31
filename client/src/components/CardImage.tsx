import type { Card } from '@mtg/shared';
import { hoverTargetFrom, type HoverTarget } from './CardPreview';

interface Props {
  card: Card;
  onClick?: () => void;
  disabled?: boolean;
  onHover?: (target: HoverTarget | null) => void;
}

export function CardImage({ card, onClick, disabled, onHover }: Props) {
  return (
    <button
      type="button"
      className="card"
      onClick={onClick}
      disabled={disabled}
      title={card.name}
      onMouseEnter={(e) => onHover?.(hoverTargetFrom(card, e.currentTarget))}
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
