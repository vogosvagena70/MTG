import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

interface Props {
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
}

/** A right-click menu: stays on screen, closes on Escape or a click elsewhere. */
export function ContextMenu({ x, y, onClose, children }: Props) {
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
      {children}
    </div>
  );
}
