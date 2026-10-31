import { useCallback, useEffect, useState } from 'react';
import type { Card, DraftStatePayload } from '@mtg/shared';
import { CardImage } from '../components/CardImage';
import { CardPreview, hoverTargetFrom, type HoverTarget } from '../components/CardPreview';
import { TableStrip } from '../components/TableStrip';
import { GROUP_LABEL, groupByColor } from '../lib/cards';
import { secondsLeft } from '../lib/session';
import { socket } from '../socket';

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export function Draft({ state }: { state: DraftStatePayload }) {
  const { view, pickDeadline, table } = state;
  const [pending, setPending] = useState(false);
  const [hover, setHover] = useState<HoverTarget | null>(null);
  const clearHover = useCallback(() => setHover(null), []);
  const left = secondsLeft(pickDeadline, useNow(pickDeadline !== null));
  const waitingFor = table.filter((s) => !s.isBot && !s.picked).map((s) => s.name);

  useEffect(() => {
    setPending(false);
    setHover(null);
  }, [view]);

  const pick = (card: Card) => {
    if (pending) return;
    setPending(true);
    socket.emit('draft:pick', { instanceId: card.instanceId });
  };

  return (
    <div className="draft">
      <header className="draft-header">
        <h1>Pack {view.packNumber} · Pick {view.pickNumber}</h1>
        <div className="draft-header-right">
          {left !== null && view.currentPack && (
            <span className={left <= 10 ? 'countdown urgent' : 'countdown'} aria-label="Time left to pick">
              {left}s
            </span>
          )}
          <span className="muted">{view.picks.length} / 45 picked</span>
        </div>
      </header>
      <TableStrip table={table} />
      <div className="draft-body">
        <section>
          {view.currentPack ? (
            <div className="card-grid">
              {view.currentPack.map((c) => (
                <CardImage key={c.instanceId} card={c} onClick={() => pick(c)} disabled={pending} onHover={setHover} />
              ))}
            </div>
          ) : (
            <p className="muted">
              {waitingFor.length > 0 ? `Waiting for: ${waitingFor.join(', ')}` : 'Waiting for the next pack…'}
            </p>
          )}
        </section>
        <aside className="picks">
          <h2>Your picks</h2>
          {view.picks.length === 0 && <p className="muted">Nothing yet. Click a card to pick it.</p>}
          {groupByColor(view.picks).map(({ group, cards }) => (
            <div key={group} className="pick-group">
              <h3>
                {GROUP_LABEL[group]} <span className="muted">{cards.length}</span>
              </h3>
              <ul>
                {cards.map((c) => (
                  <li key={c.instanceId} onMouseEnter={(e) => setHover(hoverTargetFrom(c, e.currentTarget))} onMouseLeave={clearHover}>
                    {c.name}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </aside>
      </div>
      <CardPreview target={hover} onDismiss={clearHover} />
    </div>
  );
}
