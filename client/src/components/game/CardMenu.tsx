import { useEffect } from 'react';
import type { Zone } from '@mtg/shared';

const ITEMS: { to: Zone; label: string }[] = [
  { to: 'hand', label: 'To hand' },
  { to: 'battlefield', label: 'To battlefield' },
  { to: 'graveyard', label: 'To graveyard' },
  { to: 'library', label: 'To top of library' },
];

interface Props {
  x: number;
  y: number;
  onPick: (to: Zone) => void;
  onClose: () => void;
}

export function CardMenu({ x, y, onPick, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (!(e.target as Element | null)?.closest?.('.card-menu')) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  return (
    <div className="card-menu" style={{ left: x, top: y }} role="menu">
      {ITEMS.map((i) => (
        <button key={i.to} type="button" role="menuitem" onClick={() => onPick(i.to)}>
          {i.label}
        </button>
      ))}
    </div>
  );
}
