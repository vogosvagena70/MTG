import { useEffect } from 'react';
import type { Card } from '@mtg/shared';
import { previewPosition, type Box } from '../lib/preview';

export interface HoverTarget {
  card: Card;
  rect: Box;
}

export function hoverTargetFrom(card: Card, el: Element): HoverTarget {
  const r = el.getBoundingClientRect();
  return { card, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } };
}

interface Props {
  target: HoverTarget | null;
  onDismiss: () => void;
}

export function CardPreview({ target, onDismiss }: Props) {
  // The position is computed from where the card was when hovered; hide it once that goes stale.
  useEffect(() => {
    if (!target) return;
    window.addEventListener('scroll', onDismiss, true);
    window.addEventListener('resize', onDismiss);
    return () => {
      window.removeEventListener('scroll', onDismiss, true);
      window.removeEventListener('resize', onDismiss);
    };
  }, [target, onDismiss]);

  if (!target?.card.imageUrl) return null;
  const pos = previewPosition(target.rect, { width: window.innerWidth, height: window.innerHeight });
  return (
    <div className="preview" style={{ left: pos.left, top: pos.top, width: pos.width }}>
      <img src={target.card.imageUrl} alt={target.card.name} />
    </div>
  );
}
