import type { GameCard } from '@mtg/shared';
import type { HoverTarget } from '../CardPreview';
import { CardTile } from './CardTile';

interface Props {
  mode: 'top' | 'search';
  cards: GameCard[];
  onHover: (t: HoverTarget | null) => void;
  onMenu: (gc: GameCard, x: number, y: number) => void;
  onClose: () => void;
  onShuffleClose: () => void;
}

/** Library cards only you can see. Right-click or drag them like any other card. */
export function LibraryViewer({ mode, cards, onHover, onMenu, onClose, onShuffleClose }: Props) {
  return (
    <aside className="library-viewer panel" aria-label="Library">
      <div className="row-between">
        <strong>{mode === 'top' ? `Top ${cards.length} of your library` : `Your library (${cards.length})`}</strong>
        <div className="deck-actions">
          <button type="button" className="btn" onClick={onShuffleClose}>Shuffle &amp; close</button>
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
      <p className="muted library-hint">
        {mode === 'top' ? 'Leftmost is the top card. ' : 'Sorted by name. '}Right-click a card to move it.
      </p>
      <div className="card-grid small">
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
    </aside>
  );
}
