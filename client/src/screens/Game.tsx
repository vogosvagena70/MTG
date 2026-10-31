import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameAction, GameCard, GameView, Zone } from '@mtg/shared';
import { socket } from '../socket';
import { actionErrorText } from '../lib/battle';
import { CardPreview, type HoverTarget } from '../components/CardPreview';
import { Battlefield } from '../components/game/Battlefield';
import { CardMenu } from '../components/game/CardMenu';
import { GameLog } from '../components/game/GameLog';
import { GraveyardViewer } from '../components/game/GraveyardViewer';
import { HandRow } from '../components/game/HandRow';
import { ZonePile } from '../components/game/ZonePile';

interface Props {
  view: GameView;
  onLeave: () => void;
}

type Confirm = 'mulligan' | 'concede' | null;

export function Game({ view, onLeave }: Props) {
  const [hover, setHover] = useState<HoverTarget | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [menu, setMenu] = useState<{ gc: GameCard; x: number; y: number } | null>(null);
  const [viewer, setViewer] = useState<'me' | 'opp' | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  const send = useCallback(async (action: GameAction) => {
    if (viewRef.current.over) return;
    try {
      const res = await socket.timeout(5000).emitWithAck('game:action', action);
      setStatus(actionErrorText(res));
    } catch {
      setStatus('The server did not respond.');
    }
  }, []);

  const dismissHover = useCallback(() => setHover(null), []);
  const closeMenu = useCallback(() => setMenu(null), []);

  const move = (gid: string, to: Zone, x?: number, y?: number) => {
    const from = zoneOf(viewRef.current, gid);
    if (!from) return;
    // dropping onto the zone the card is already in (other than repositioning) is a no-op
    if (from === to && to !== 'battlefield') return;
    void send(to === 'battlefield' ? { type: 'move', gid, to, x, y } : { type: 'move', gid, to });
  };

  const toggleTap = (gc: GameCard) => void send({ type: 'tap', gid: gc.gid, tapped: !gc.tapped });

  // T toggles tap on the battlefield card under the pointer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 't' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const els = document.querySelectorAll('.battlefield.mine .gcard:hover');
      const gid = els[els.length - 1]?.getAttribute('data-gid');
      const gc = viewRef.current.me.battlefield.find((c) => c.gid === gid);
      if (gc && !viewRef.current.over) {
        setHover(null);
        void send({ type: 'tap', gid: gc.gid, tapped: !gc.tapped });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [send]);

  const leave = async () => {
    try {
      await socket.timeout(5000).emitWithAck('game:leave', {});
    } catch {
      // leave anyway
    }
    onLeave();
  };

  const armed = (which: Exclude<Confirm, null>, label: string, run: () => void) => (
    <button
      type="button"
      disabled={!!view.over}
      className={`btn${confirm === which ? ' btn-danger' : ''}`}
      onClick={() => {
        if (confirm === which) {
          setConfirm(null);
          run();
        } else {
          setConfirm(which);
        }
      }}
      onBlur={() => setConfirm((c) => (c === which ? null : c))}
    >
      {confirm === which ? 'Are you sure?' : label}
    </button>
  );

  const { me, opp } = view;
  const over = view.over;
  const concededName = over ? (over.conceded === view.you ? me.name : opp.name) : '';
  const menuMove = (to: Zone) => {
    setHover(null);
    if (menu) move(menu.gc.gid, to, 50, 50);
    setMenu(null);
  };

  return (
    <main className="game">
      <section className="strip">
        <strong>{opp.name}</strong>
        {!opp.connected && <span className="badge">offline</span>}
        <span>Life {opp.life}</span>
        <span>Hand {opp.handCount}</span>
        <ZonePile label="Library" count={opp.libraryCount} />
        <ZonePile label="Graveyard" count={opp.graveyard.length} onClick={() => setViewer(viewer === 'opp' ? null : 'opp')} />
      </section>

      <Battlefield cards={opp.battlefield} mine={false} onHover={setHover} />
      <Battlefield
        cards={me.battlefield}
        mine
        onHover={setHover}
        onDropCard={(gid, x, y) => move(gid, 'battlefield', x, y)}
        onToggleTap={toggleTap}
        onMenu={(gc, x, y) => setMenu({ gc, x, y })}
      />

      <section className="strip">
        <strong>{me.name}</strong>
        <span className="life">
          <button type="button" className="btn" aria-label="Lose 1 life" disabled={!!over} onClick={() => void send({ type: 'life', delta: -1 })}>-</button>
          <span className="life-total">{me.life}</span>
          <button type="button" className="btn" aria-label="Gain 1 life" disabled={!!over} onClick={() => void send({ type: 'life', delta: 1 })}>+</button>
        </span>
        <ZonePile label="Library" count={me.libraryCount} title="Click to draw a card" onClick={() => void send({ type: 'draw', count: 1 })} />
        <ZonePile
          label="Graveyard"
          count={me.graveyard.length}
          onClick={() => setViewer(viewer === 'me' ? null : 'me')}
          onDropCard={(gid) => move(gid, 'graveyard')}
        />
        <button type="button" className="btn" disabled={!!over} onClick={() => void send({ type: 'untapAll' })}>Untap all</button>
        <button type="button" className="btn" disabled={!!over} onClick={() => void send({ type: 'shuffle' })}>Shuffle</button>
        {armed('mulligan', 'Mulligan', () => void send({ type: 'mulligan' }))}
        {armed('concede', 'Concede', () => void send({ type: 'concede' }))}
        <span className="status warn" role="status">{status}</span>
      </section>

      <HandRow
        cards={me.hand}
        onHover={setHover}
        onDropCard={(gid) => move(gid, 'hand')}
        onMenu={(gc, x, y) => setMenu({ gc, x, y })}
      />

      {viewer && (
        <GraveyardViewer
          title={viewer === 'me' ? 'Your graveyard' : `${opp.name}'s graveyard`}
          cards={viewer === 'me' ? me.graveyard : opp.graveyard}
          mine={viewer === 'me'}
          onHover={setHover}
          onMenu={(gc, x, y) => setMenu({ gc, x, y })}
          onClose={() => setViewer(null)}
        />
      )}
      <GameLog log={view.log} />
      {menu && <CardMenu x={menu.x} y={menu.y} onPick={menuMove} onClose={closeMenu} />}
      <CardPreview target={hover} onDismiss={dismissHover} />

      {over && (
        <div className="game-over" role="dialog">
          <div className="panel">
            <h2>{concededName} conceded</h2>
            <button type="button" className="btn btn-primary" onClick={() => void leave()}>Back to room</button>
          </div>
        </div>
      )}
    </main>
  );
}

function zoneOf(view: GameView, gid: string): Zone | null {
  if (view.me.battlefield.some((c) => c.gid === gid)) return 'battlefield';
  if (view.me.hand.some((c) => c.gid === gid)) return 'hand';
  if (view.me.graveyard.some((c) => c.gid === gid)) return 'graveyard';
  return null;
}
