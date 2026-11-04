import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Zone } from '@mtg/shared';

const ITEMS: { to: Zone; bottom?: boolean; label: string }[] = [
  { to: 'hand', label: 'To hand' },
  { to: 'battlefield', label: 'To battlefield' },
  { to: 'graveyard', label: 'To graveyard' },
  { to: 'exile', label: 'To exile' },
  { to: 'library', label: 'To top of library' },
  { to: 'library', bottom: true, label: 'To bottom of library' },
];

interface Props {
  x: number;
  y: number;
  onPick: (to: Zone, bottom?: boolean) => void;
  onClose: () => void;
  /** Battlefield cards only: current counter tally and how to change it. The menu stays open. */
  counters?: { value: number; onChange: (delta: 1 | -1) => void };
}

export function CardMenu({ x, y, onPick, onClose, counters }: Props) {
  // keep the whole menu on screen, e.g. when right-clicking a card in the hand row
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({
      left: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)),
    });
  }, [x, y]);

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
    <div ref={ref} className="card-menu" style={pos} role="menu">
      {ITEMS.map((i) => (
        <button key={i.label} type="button" role="menuitem" onClick={() => onPick(i.to, i.bottom)}>
          {i.label}
        </button>
      ))}
      {counters && (
        <div className="card-menu-counters">
          <span>Counters</span>
          <button type="button" aria-label="Remove a counter" onClick={() => counters.onChange(-1)}>−</button>
          <span className="card-menu-count">{counters.value}</span>
          <button type="button" aria-label="Add a counter" onClick={() => counters.onChange(1)}>+</button>
        </div>
      )}
    </div>
  );
}
