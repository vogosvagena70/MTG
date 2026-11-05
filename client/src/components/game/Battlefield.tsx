import { useRef, type DragEvent } from 'react';
import type { GameCard } from '@mtg/shared';
import { dropPosition } from '../../lib/battle';
import type { HoverTarget } from '../CardPreview';
import { CardTile } from './CardTile';

interface Props {
  cards: GameCard[];
  mine: boolean;
  onHover: (t: HoverTarget | null) => void;
  onDropCard?: (gid: string, x: number, y: number) => void;
  onToggleTap?: (gc: GameCard) => void;
  onMenu?: (gc: GameCard, x: number, y: number) => void;
}

export function Battlefield({ cards, mine, onHover, onDropCard, onToggleTap, onMenu }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const drop = (e: DragEvent) => {
    e.preventDefault();
    const gid = e.dataTransfer.getData('text/plain');
    if (!gid || !ref.current || !onDropCard) return;
    const [gx, gy] = (e.dataTransfer.getData('application/x-grab') || '0,0').split(',').map(Number);
    const pos = dropPosition(ref.current.getBoundingClientRect(), e.clientX - (gx || 0), e.clientY - (gy || 0));
    onDropCard(gid, pos.x, pos.y);
  };
  return (
    <div
      ref={ref}
      className={`battlefield${mine ? ' mine' : ' theirs'}`}
      onDragOver={mine ? (e) => e.preventDefault() : undefined}
      onDrop={mine ? drop : undefined}
    >
      {cards.map((gc) => (
        <CardTile
          key={gc.gid}
          gc={gc}
          mine={mine}
          className="on-field"
          style={{ left: `${gc.x}%`, top: `${gc.y}%` }}
          onHover={onHover}
          onDoubleClick={() => onToggleTap?.(gc)}
          onContextMenu={(e) => {
            e.preventDefault();
            onMenu?.(gc, e.clientX, e.clientY);
          }}
        />
      ))}
    </div>
  );
}
