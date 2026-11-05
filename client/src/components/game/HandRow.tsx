import type { GameCard } from '@mtg/shared';
import type { HoverTarget } from '../CardPreview';
import { CardTile } from './CardTile';

interface Props {
  cards: GameCard[];
  onHover: (t: HoverTarget | null) => void;
  onDropCard: (gid: string) => void;
  onMenu: (gc: GameCard, x: number, y: number) => void;
}

export function HandRow({ cards, onHover, onDropCard, onMenu }: Props) {
  return (
    <div
      className="hand-row"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const gid = e.dataTransfer.getData('text/plain');
        if (gid) onDropCard(gid);
      }}
    >
      {cards.length === 0 && <span className="muted">Your hand is empty</span>}
      {cards.map((gc) => (
        <CardTile
          key={gc.gid}
          gc={gc}
          mine
          onHover={onHover}
          onContextMenu={(e) => {
            e.preventDefault();
            onMenu(gc, e.clientX, e.clientY);
          }}
        />
      ))}
    </div>
  );
}
