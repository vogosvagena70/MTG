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
import { MechanicsMenu } from '../components/game/MechanicsMenu';
import { LibraryViewer } from '../components/game/LibraryViewer';
import { ZonePile } from '../components/game/ZonePile';

interface Props {
  view: GameView;
  onLeave: () => void;
  /** Label for the game-over button. */
  leaveLabel?: string;
}

type Confirm = 'mulligan' | 'concede' | null;
/** Which public pile the side viewer shows. */
type Pile = { who: 'me' | 'opp'; zone: 'graveyard' | 'exile' };
const ZONE_NAME = { graveyard: 'graveyard', exile: 'exile' } as const;

export function Game({ view, onLeave, leaveLabel = 'Back to room' }: Props) {
  const [hover, setHover] = useState<HoverTarget | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [menu, setMenu] = useState<{ gc: GameCard; x: number; y: number } | null>(null);
  const [viewer, setViewer] = useState<Pile | null>(null);
  const toggleViewer = (who: Pile['who'], zone: Pile['zone']) =>
    setViewer((v) => (v && v.who === who && v.zone === zone ? null : { who, zone }));
  const [showLog, setShowLog] = useState(false);
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

  const move = (gid: string, to: Zone, x?: number, y?: number, bottom?: boolean) => {
    const from = zoneOf(viewRef.current, gid);
    if (!from) return;
    // dropping onto the zone the card is already in (other than repositioning) is a no-op
    if (from === to && to !== 'battlefield' && to !== 'library') return;
    if (to === 'battlefield') void send({ type: 'move', gid, to, x, y });
    else if (to === 'library') void send({ type: 'move', gid, to, bottom });
    else void send({ type: 'move', gid, to });
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
  // the live copy of the right-clicked card, if it is on your battlefield (so the counter shown stays current)
  const menuCard = menu ? me.battlefield.find((c) => c.gid === menu.gc.gid) : undefined;
  const menuMove = (to: Zone, bottom?: boolean) => {
    setHover(null);
    if (menu) move(menu.gc.gid, to, 50, 50, bottom);
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
        <ZonePile label="Graveyard" count={opp.graveyard.length} onClick={() => toggleViewer('opp', 'graveyard')} />
        <ZonePile label="Exile" count={opp.exile.length} onClick={() => toggleViewer('opp', 'exile')} />
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
        <ZonePile label="Library" count={me.libraryCount} />
        <ZonePile
          label="Graveyard"
          count={me.graveyard.length}
          onClick={() => toggleViewer('me', 'graveyard')}
          onDropCard={(gid) => move(gid, 'graveyard')}
        />
        <ZonePile
          label="Exile"
          count={me.exile.length}
          onClick={() => toggleViewer('me', 'exile')}
          onDropCard={(gid) => move(gid, 'exile')}
        />
        <button type="button" className="btn" disabled={!!over || me.libraryCount === 0} onClick={() => void send({ type: 'draw', count: 1 })}>Draw</button>
        <button type="button" className="btn" disabled={!!over} onClick={() => void send({ type: 'untapAll' })}>Untap all</button>
        <button type="button" className="btn" disabled={!!over} onClick={() => void send({ type: 'shuffle' })}>Shuffle</button>
        <MechanicsMenu
          disabled={!!over}
          libraryCount={me.libraryCount}
          onSearchTop={(count) => void send({ type: 'searchTop', count })}
          onSearchLibrary={() => void send({ type: 'searchLibrary' })}
          onToken={(name, power, toughness) => void send({ type: 'token', name, power, toughness })}
        />
        {armed('mulligan', 'Mulligan', () => void send({ type: 'mulligan' }))}
        {armed('concede', 'Concede', () => void send({ type: 'concede' }))}
        <button type="button" className="btn" onClick={() => setShowLog(!showLog)}>{showLog ? 'Hide log' : 'Show log'}</button>
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
          title={viewer.who === 'me' ? `Your ${ZONE_NAME[viewer.zone]}` : `${opp.name}'s ${ZONE_NAME[viewer.zone]}`}
          cards={(viewer.who === 'me' ? me : opp)[viewer.zone]}
          mine={viewer.who === 'me'}
          onHover={setHover}
          onMenu={(gc, x, y) => setMenu({ gc, x, y })}
          onClose={() => setViewer(null)}
        />
      )}
      {me.peek && (
        <LibraryViewer
          mode={me.peek.mode}
          cards={me.peek.cards}
          onHover={setHover}
          onMenu={(gc, x, y) => setMenu({ gc, x, y })}
          onClose={() => {
            setHover(null);
            void send({ type: 'closeLibrary' });
          }}
          onShuffleClose={() => {
            setHover(null);
            void send({ type: 'shuffle' });
          }}
        />
      )}
      {showLog && <GameLog log={view.log} onClose={() => setShowLog(false)} />}
      {menu && (
        <CardMenu
          x={menu.x}
          y={menu.y}
          onPick={menuMove}
          onClose={closeMenu}
          counters={menuCard && !over ? { value: menuCard.counters, onChange: (delta) => void send({ type: 'counters', gid: menuCard.gid, delta }) } : undefined}
        />
      )}
      <CardPreview target={hover} onDismiss={dismissHover} />

      {over && (
        <div className="game-over" role="dialog">
          <div className="panel">
            <h2>{concededName} conceded</h2>
            <button type="button" className="btn btn-primary" onClick={() => void leave()}>{leaveLabel}</button>
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
  if (view.me.exile.some((c) => c.gid === gid)) return 'exile';
  if (view.me.peek?.cards.some((c) => c.gid === gid)) return 'library';
  return null;
}
