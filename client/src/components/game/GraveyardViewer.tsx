import type { GameCard } from '@mtg/shared';
import type { HoverTarget } from '../CardPreview';
import { CardTile } from './CardTile';

interface Props {
  title: string;
  cards: GameCard[];
  mine: boolean;
  onHover: (t: HoverTarget | null) => void;
  onMenu?: (gc: GameCard, x: number, y: number) => void;
  onClose: () => void;
}

export function GraveyardViewer({ title, cards, mine, onHover, onMenu, onClose }: Props) {
  return (
    <aside className="graveyard-viewer panel">
      <div className="row-between">
        <strong>{title} ({cards.length})</strong>
        <button type="button" className="btn" onClick={onClose}>Close</button>
      </div>
      {cards.length === 0 && <p className="muted">Empty</p>}
      <div className="card-grid small">
        {cards.map((gc) => (
          <CardTile
            key={gc.gid}
            gc={gc}
            mine={mine}
            onHover={onHover}
            onContextMenu={(e) => {
              e.preventDefault();
              onMenu?.(gc, e.clientX, e.clientY);
            }}
          />
        ))}
      </div>
    </aside>
  );
}
