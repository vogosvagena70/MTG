import { useEffect, useState } from 'react';
import type { IncomingChallenge, RosterPlayer } from '@mtg/shared';
import { canChallenge, secondsUntil } from '../lib/battle';

interface Props {
  roster: RosterPlayer[];
  incoming: IncomingChallenge | null;
  onChallenge: (playerId: string) => void;
  onRespond: (accept: boolean) => void;
  status: string | null;
}

export function RoomPanel({ roster, incoming, onChallenge, onRespond, status }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!incoming) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [incoming]);

  const me = roster.find((p) => p.isYou);
  const left = incoming ? secondsUntil(incoming.expiresAt, now) : 0;

  return (
    <section className="panel room-panel">
      <h2>Room</h2>
      {incoming && left > 0 && (
        <div className="challenge-banner" role="alert">
          <span>{incoming.fromName} challenges you</span>
          <span className="muted">{left}s</span>
          <button className="btn btn-primary" onClick={() => onRespond(true)}>Accept</button>
          <button className="btn" onClick={() => onRespond(false)}>Decline</button>
        </div>
      )}
      {me && !me.deckSaved && <p className="muted">Save your deck to battle</p>}
      <ul className="roster">
        {roster.map((p) => (
          <li key={p.playerId}>
            <span>
              {p.name}{p.isYou ? ' (you)' : ''}{' '}
              <span className="muted">
                {p.inGame ? 'in a game' : !p.connected ? 'offline' : p.deckSaved ? 'ready' : 'building'}
              </span>
            </span>
            {!p.isYou && (
              <button className="btn" disabled={!canChallenge(me, p)} onClick={() => onChallenge(p.playerId)}>
                Challenge
              </button>
            )}
          </li>
        ))}
      </ul>
      {status && <p className="muted">{status}</p>}
    </section>
  );
}
