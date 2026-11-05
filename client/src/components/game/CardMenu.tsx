import { useState } from 'react';
import type { GameCard, Zone } from '@mtg/shared';
import { ContextMenu } from './ContextMenu';

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
  faceDown: boolean;
  onFlip: () => void;
  /** Battlefield cards only: current counters and how to change them. The menu stays open. */
  counters?: {
    plain: number;
    pt: GameCard['ptCounters'];
    onPlain: (delta: 1 | -1) => void;
    onPt: (power: number, toughness: number) => void;
  };
}

const MAX_STEP = 99;
const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
const validStep = (n: number) => Number.isInteger(n) && Math.abs(n) <= MAX_STEP;

export function CardMenu({ x, y, onPick, onClose, faceDown, onFlip, counters }: Props) {
  // how much + and − change the power/toughness counters; starts at 1/1 and can be any whole number
  const [powerText, setPowerText] = useState('1');
  const [toughnessText, setToughnessText] = useState('1');
  const power = powerText.trim() === '' ? NaN : Number(powerText);
  const toughness = toughnessText.trim() === '' ? NaN : Number(toughnessText);
  const stepOk = validStep(power) && validStep(toughness) && (power !== 0 || toughness !== 0);
  return (
    <ContextMenu x={x} y={y} onClose={onClose}>
      {ITEMS.map((i) => (
        <button key={i.label} type="button" role="menuitem" onClick={() => onPick(i.to, i.bottom)}>
          {i.label}
        </button>
      ))}
      <button type="button" role="menuitem" className="card-menu-flip" onClick={onFlip}>
        {faceDown ? 'Flip face up' : 'Flip face down'}
      </button>
      {counters && (
        <>
          <div className="card-menu-counters">
            <span>P/T counters</span>
            <span className="card-menu-count">{signed(counters.pt.power)}/{signed(counters.pt.toughness)}</span>
          </div>
          <div className="card-menu-counters card-menu-pt">
            <input type="number" value={powerText} aria-label="Power to add" onChange={(e) => setPowerText(e.target.value)} />
            <span>/</span>
            <input type="number" value={toughnessText} aria-label="Toughness to add" onChange={(e) => setToughnessText(e.target.value)} />
            <button type="button" aria-label="Subtract these power and toughness counters" disabled={!stepOk} onClick={() => counters.onPt(-power, -toughness)}>−</button>
            <button type="button" aria-label="Add these power and toughness counters" disabled={!stepOk} onClick={() => counters.onPt(power, toughness)}>+</button>
          </div>
          <div className="card-menu-counters">
            <span>Counters</span>
            <button type="button" aria-label="Remove a counter" disabled={counters.plain === 0} onClick={() => counters.onPlain(-1)}>−</button>
            <span className="card-menu-count">{counters.plain}</span>
            <button type="button" aria-label="Add a counter" onClick={() => counters.onPlain(1)}>+</button>
          </div>
        </>
      )}
    </ContextMenu>
  );
}
