import { useState } from 'react';
import type { LobbyView } from '@mtg/shared';
import { socket } from '../socket';

interface Props {
  lobby: LobbyView;
  playerId: string;
  onLeave: () => void;
}

export function Lobby({ lobby, playerId, onLeave }: Props) {
  const [status, setStatus] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const isHost = lobby.hostPlayerId === playerId;
  const invite = `${location.origin}/?room=${lobby.code}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(invite);
      setStatus('Invite link copied');
    } catch {
      setStatus(`Copy failed. Share this link: ${invite}`);
    }
  };

  const start = async () => {
    setStarting(true);
    setStatus(null);
    try {
      const res = await socket.timeout(30_000).emitWithAck('room:start', {});
      if (!res.ok) setStatus(res.message);
    } catch {
      setStatus('The server did not respond.');
    } finally {
      setStarting(false);
    }
  };

  return (
    <main className="home lobby">
      <div>
        <div className="muted">Room code</div>
        <div className="room-code">{lobby.code}</div>
      </div>
      <div className="home-row">
        <button className="btn" onClick={copy}>Copy invite link</button>
        <button className="btn" onClick={onLeave}>Leave</button>
      </div>
      {status && <p className="muted" role="status">{status}</p>}

      <section className="panel">
        <h2>
          {lobby.setName} <span className="muted">({lobby.setCode.toUpperCase()})</span>
        </h2>
        <p className="muted">Pick timer: {lobby.timerSeconds ? `${lobby.timerSeconds} seconds` : 'off'}</p>
        <h2>Players {lobby.players.length} / 8</h2>
        <ul className="players">
          {lobby.players.map((p) => (
            <li key={p.playerId}>
              <span className={p.connected ? 'dot on' : 'dot'} title={p.connected ? 'Online' : 'Offline'} />
              {p.name}
              {p.playerId === playerId && <span className="muted"> (you)</span>}
              {p.playerId === lobby.hostPlayerId && <span className="badge">host</span>}
            </li>
          ))}
        </ul>
      </section>

      {isHost ? (
        <div>
          <button className="btn btn-primary" onClick={start} disabled={starting}>
            {starting ? 'Starting…' : 'Start draft'}
          </button>
          <p className="muted">Empty seats will be filled by bots.</p>
        </div>
      ) : (
        <p className="muted">Waiting for the host to start…</p>
      )}
    </main>
  );
}
