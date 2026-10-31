import { useCallback, useState, type ReactNode } from 'react';
import { COLORS, type Card, type Color } from '@mtg/shared';
import { CardImage } from '../components/CardImage';
import { CardPreview, type HoverTarget } from '../components/CardPreview';
import { BASIC_NAMES, buildDecklist, deckSize, manaCurve } from '../lib/cards';
import { socket } from '../socket';

const MIN_DECK = 40;
const byCurve = (a: Card, b: Card) => a.manaValue - b.manaValue || a.name.localeCompare(b.name);

interface Props {
  pool: Card[];
  /** Instance ids of the main-deck cards (owned by App so it survives the game screen). */
  main: Set<string>;
  basics: Record<Color, number>;
  onChangeDeck: (main: Set<string>, basics: Record<Color, number>) => void;
  onNewDraft: () => void;
  notice?: string | null;
  roomPanel?: ReactNode;
}

export function Deckbuilder({ pool, main: mainIds, basics, onChangeDeck, onNewDraft, notice, roomPanel }: Props) {
  const [hover, setHover] = useState<HoverTarget | null>(null);
  const clearHover = useCallback(() => setHover(null), []);
  const [status, setStatus] = useState<string | null>(null);

  const main = pool.filter((c) => mainIds.has(c.instanceId)).sort(byCurve);
  const side = pool.filter((c) => !mainIds.has(c.instanceId)).sort(byCurve);
  const total = deckSize(main, basics);
  const curve = manaCurve(main);
  const curveMax = Math.max(1, ...curve);
  const decklist = buildDecklist(main, side, basics);

  const toggle = (card: Card) => {
    setStatus(null);
    setHover(null); // the card moves to the other area, so its old position is stale
    const next = new Set(mainIds);
    if (next.has(card.instanceId)) next.delete(card.instanceId);
    else next.add(card.instanceId);
    onChangeDeck(next, basics);
  };

  const adjust = (color: Color, delta: number) => {
    setStatus(null);
    onChangeDeck(mainIds, { ...basics, [color]: Math.max(0, basics[color] + delta) });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(decklist);
      setStatus('Decklist copied to clipboard');
    } catch {
      setStatus('Copy failed. Use Download instead.');
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([decklist], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'practice-deck.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const save = async () => {
    try {
      const res = await socket.timeout(5_000).emitWithAck('deck:save', { main: [...mainIds], basics });
      setStatus(res.ok ? 'Deck saved' : `Save failed: ${res.message ?? 'unknown error'}`);
    } catch {
      setStatus('Save failed: server did not respond');
    }
  };

  return (
    <div className="deck">
      <header className="deck-header">
        <div>
          <h1>Deckbuilder</h1>
          <span className={total < MIN_DECK ? 'warn' : 'muted'}>
            {total} cards{total < MIN_DECK ? ` (minimum ${MIN_DECK})` : ''}
          </span>
        </div>
        <div className="deck-actions">
          <button className="btn" onClick={copy}>Export</button>
          <button className="btn" onClick={download}>Download</button>
          <button className="btn btn-primary" onClick={save}>Save</button>
          <button className="btn" onClick={onNewDraft}>New draft</button>
        </div>
      </header>
      {(status ?? notice) && <p className="muted">{status ?? notice}</p>}

      {roomPanel}

      <div className="deck-tools">
        <div className="basics">
          {COLORS.map((c) => (
            <div key={c} className="basic">
              <span>{BASIC_NAMES[c]}</span>
              <button className="btn" onClick={() => adjust(c, -1)} aria-label={`Remove ${BASIC_NAMES[c]}`}>−</button>
              <span className="basic-count">{basics[c]}</span>
              <button className="btn" onClick={() => adjust(c, 1)} aria-label={`Add ${BASIC_NAMES[c]}`}>+</button>
            </div>
          ))}
        </div>
        <div className="curve" aria-label="Mana curve">
          {curve.map((n, i) => (
            <div key={i} className="curve-col">
              <span className="curve-n">{n}</span>
              <div className="curve-bar" style={{ height: `${(n / curveMax) * 80}px` }} />
              <span className="muted">{i === 6 ? '6+' : i}</span>
            </div>
          ))}
        </div>
      </div>

      <section>
        <h2>Main deck <span className="muted">{main.length} + {total - main.length} basics</span></h2>
        {main.length === 0 && <p className="muted">Click cards in your pool to add them.</p>}
        <div className="card-grid small">
          {main.map((c) => <CardImage key={c.instanceId} card={c} onClick={() => toggle(c)} onHover={setHover} />)}
        </div>
      </section>

      <section>
        <h2>Pool <span className="muted">{side.length}</span></h2>
        <div className="card-grid small">
          {side.map((c) => <CardImage key={c.instanceId} card={c} onClick={() => toggle(c)} onHover={setHover} />)}
        </div>
      </section>

      <CardPreview target={hover} onDismiss={clearHover} />
    </div>
  );
}
