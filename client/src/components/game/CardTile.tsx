import type { CSSProperties, DragEvent, MouseEvent } from 'react';
import type { GameCard } from '@mtg/shared';
import { hoverTargetFrom, type HoverTarget } from '../CardPreview';

interface Props {
  gc: GameCard;
  mine?: boolean;
  style?: CSSProperties;
  className?: string;
  onHover?: (t: HoverTarget | null) => void;
  onDoubleClick?: () => void;
  onContextMenu?: (e: MouseEvent) => void;
}

const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
const ptLabel = (pt: GameCard['ptCounters']) => `${signed(pt.power)}/${signed(pt.toughness)}`;

// A draggable card face. Not a <button>, so native drag works in all browsers.
export function CardTile({ gc, mine, style, className, onHover, onDoubleClick, onContextMenu }: Props) {
  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData('text/plain', gc.gid);
    e.dataTransfer.effectAllowed = 'move';
    // remember where inside the card the grab happened so drops land under the cursor
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    e.dataTransfer.setData('application/x-grab', `${e.clientX - r.left - r.width / 2},${e.clientY - r.top - r.height / 2}`);
    onHover?.(null);
  };
  return (
    <div
      className={`gcard${gc.tapped ? ' tapped' : ''}${className ? ` ${className}` : ''}`}
      style={style}
      title={gc.card.name}
      data-gid={gc.gid}
      draggable={!!mine}
      onDragStart={mine ? onDragStart : undefined}
      onDoubleClick={mine ? onDoubleClick : undefined}
      onContextMenu={mine ? onContextMenu : undefined}
      onMouseEnter={(e) => onHover?.(hoverTargetFrom(gc.card, e.currentTarget))}
      onMouseLeave={() => onHover?.(null)}
    >
      {gc.faceDown ? (
        <span className="card-back" aria-label="Face-down card" />
      ) : gc.token ? (
        <span className="token-face">
          <span className="token-name">{gc.card.name}</span>
          <span className="token-type">Token</span>
          {gc.card.oracleText && <span className="token-description">{gc.card.oracleText}</span>}
          {gc.token.power && <span className="token-pt">{gc.token.power}/{gc.token.toughness}</span>}
        </span>
      ) : gc.card.imageUrl ? (
        <img src={gc.card.imageUrl} alt={gc.card.name} draggable={false} />
      ) : (
        <span className="card-fallback">{gc.card.name}</span>
      )}
      {!!gc.counters && (
        <span className="counter-badge" aria-label={`${gc.counters} counters`}>{gc.counters}</span>
      )}
      {(gc.ptCounters.power !== 0 || gc.ptCounters.toughness !== 0) && (
        <span className={`counter-badge pt${gc.ptCounters.power <= 0 && gc.ptCounters.toughness <= 0 ? ' negative' : ''}`}>
          {ptLabel(gc.ptCounters)}
        </span>
      )}
    </div>
  );
}
