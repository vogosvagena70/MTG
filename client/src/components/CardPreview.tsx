import { useEffect, useState } from 'react';
import type { Card } from '@mtg/shared';
import { focusedPreviewPosition, largeImageUrl, previewPosition, type Box } from '../lib/preview';

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

/** Whether Alt is held right now. */
function useAltHeld(): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Alt') return;
      e.preventDefault(); // otherwise the browser moves focus to its menu
      setHeld(e.type === 'keydown');
    };
    // Alt can be released while another window has focus, e.g. after Alt+Tab
    const release = () => setHeld(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', release);
    };
  }, []);
  return held;
}

export function CardPreview({ target, onDismiss }: Props) {
  const focused = useAltHeld();
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

  if (!target) return null;
  const { card } = target;
  const isToken = card.scryfallId === 'token'; // tokens have no image, so their text is shown instead
  if (!card.imageUrl && !isToken) return null;
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const pos = focused ? focusedPreviewPosition(viewport) : previewPosition(target.rect, viewport);
  return (
    <div className={`preview${focused ? ' focused' : ''}`} style={{ left: pos.left, top: pos.top, width: pos.width }}>
      {card.imageUrl ? (
        <img src={focused ? largeImageUrl(card.imageUrl) : card.imageUrl} alt={card.name} />
      ) : (
        <div className="token-preview">
          <strong>{card.name}</strong>
          <span className="muted">{card.typeLine}</span>
          {card.oracleText && <p>{card.oracleText}</p>}
        </div>
      )}
    </div>
  );
}
