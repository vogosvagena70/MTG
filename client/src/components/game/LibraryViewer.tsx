import { useState, type DragEvent } from 'react';
import type { GameCard, PeekMode, Zone } from '@mtg/shared';
import type { HoverTarget } from '../CardPreview';
import { CardTile } from './CardTile';
import { reorder } from '../../lib/reorder';

interface Props {
  mode: PeekMode;
  cards: GameCard[];
  /** How many of `cards` are still together on top; the rest were sent further down. */
  topCount: number;
  onHover: (t: HoverTarget | null) => void;
  onMenu: (gc: GameCard, x: number, y: number) => void;
  /** Scry/surveil quick buttons under each card. */
  onMove: (gid: string, to: Zone, bottom?: boolean) => void;
  /** New order for every card in the window. */
  onArrange: (gids: string[]) => void;
  onClose: () => void;
  onShuffleClose: () => void;
}

const TITLE: Record<PeekMode, (n: number) => string> = {
  top: (n) => `Top ${n} of your library`,
  search: (n) => `Your library (${n})`,
  scry: (n) => `Scry ${n}`,
  surveil: (n) => `Surveil ${n}`,
};

const HINT: Record<PeekMode, string> = {
  top: 'Leftmost is the top of your library. Drag cards to reorder them, or right-click a card to move it.',
  search: 'Leftmost is the top of your library. Drag cards to reorder them, or right-click a card to move it.',
  scry: 'Leftmost is the top. Drag cards to put them in any order, send the ones you don\'t want to the bottom, then click Done.',
  surveil: 'Leftmost is the top. Drag cards to put them in any order, send the ones you don\'t want to the graveyard, then click Done.',
};

/** Library cards only you can see. Drag to reorder, right-click to move like any other card. */
export function LibraryViewer({ mode, cards, topCount, onHover, onMenu, onMove, onArrange, onClose, onShuffleClose }: Props) {
  const look = mode === 'scry' || mode === 'surveil';
  const [dropAt, setDropAt] = useState<{ gid: string; after: boolean } | null>(null);
  const ids = cards.map((c) => c.gid);
  const group = (i: number) => (i < topCount ? 0 : 1);

  const dropSide = (e: DragEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientX > r.left + r.width / 2;
  };

  const drop = (e: DragEvent, target: string) => {
    e.preventDefault();
    setDropAt(null);
    const dragged = e.dataTransfer.getData('text/plain');
    const from = ids.indexOf(dragged);
    const to = ids.indexOf(target);
    // only cards from this window, and only within their own group (top or bottom); the buttons move between them
    if (from < 0 || to < 0 || group(from) !== group(to)) return;
    const next = reorder(ids, dragged, target, dropSide(e));
    if (next.some((g, i) => g !== ids[i])) onArrange(next);
  };

  return (
    <aside className="library-viewer panel" aria-label="Library">
      <div className="row-between">
        <strong>{TITLE[mode](cards.length)}</strong>
        <div className="deck-actions">
          {!look && <button type="button" className="btn" onClick={onShuffleClose}>Shuffle &amp; close</button>}
          <button type="button" className={`btn${look ? ' btn-primary' : ''}`} onClick={onClose}>
            {look ? 'Done' : 'Close'}
          </button>
        </div>
      </div>
      <p className="muted library-hint">{HINT[mode]}</p>
      <div
        className="library-row"
        onWheel={(e) => {
          // a normal mouse wheel scrolls the row sideways
          if (e.deltaY !== 0) e.currentTarget.scrollLeft += e.deltaY;
        }}
      >
        {cards.map((gc, i) => {
          const bottomStart = look && i === topCount;
          const mark = dropAt?.gid === gc.gid ? (dropAt.after ? ' drop-after' : ' drop-before') : '';
          return (
            <div
              key={gc.gid}
              className={`library-slot${bottomStart ? ' library-bottom-start' : ''}${mark}`}
              onDragOver={(e) => {
                e.preventDefault();
                const after = dropSide(e);
                if (dropAt?.gid !== gc.gid || dropAt.after !== after) setDropAt({ gid: gc.gid, after });
              }}
              onDragLeave={() => setDropAt((d) => (d?.gid === gc.gid ? null : d))}
              onDrop={(e) => drop(e, gc.gid)}
            >
              {bottomStart && <span className="library-bottom-label">On the bottom</span>}
              <CardTile
                gc={gc}
                mine
                onHover={onHover}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onMenu(gc, e.clientX, e.clientY);
                }}
              />
              {look && (
                <div className="library-pick">
                  <button type="button" className="btn" disabled={i === 0} onClick={() => onMove(gc.gid, 'library')}>
                    Top
                  </button>
                  {mode === 'scry' ? (
                    <button type="button" className="btn" disabled={i >= topCount} onClick={() => onMove(gc.gid, 'library', true)}>
                      Bottom
                    </button>
                  ) : (
                    <button type="button" className="btn" onClick={() => onMove(gc.gid, 'graveyard')}>Graveyard</button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
