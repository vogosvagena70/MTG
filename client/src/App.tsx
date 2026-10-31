import { useEffect, useRef, useState } from 'react';
import type { Ack, Card, DraftStatePayload, LobbyView, SessionInfo } from '@mtg/shared';
import { socket } from './socket';
import { loadName, loadSession, roomCodeFromUrl, saveName, saveSession } from './lib/session';
import { Home } from './screens/Home';
import { Draft } from './screens/Draft';
import { Deckbuilder } from './screens/Deckbuilder';
import { Lobby } from './screens/Lobby';

type Screen =
  | { name: 'home' }
  | { name: 'lobby'; lobby: LobbyView }
  | { name: 'draft'; state: DraftStatePayload }
  | { name: 'deck'; pool: Card[] };

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [session, setSession] = useState<SessionInfo | null>(() => loadSession());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const takenOver = useRef(false); // another tab owns the saved session; stop auto-resuming

  const remember = (s: SessionInfo | null) => {
    saveSession(s);
    setSession(s);
  };

  useEffect(() => {
    const onLobby = (lobby: LobbyView) => {
      setBusy(false);
      setError(null);
      setScreen({ name: 'lobby', lobby });
    };
    const onState = (state: DraftStatePayload) => {
      setBusy(false);
      setError(null);
      setScreen({ name: 'draft', state });
    };
    const onComplete = ({ pool }: { pool: Card[] }) => {
      setNotice(null);
      setScreen((s) => (s.name === 'deck' ? s : { name: 'deck', pool }));
    };
    const onError = ({ message }: { message: string }) => {
      saveSession(null);
      setSession(null);
      setBusy(false);
      if (screenRef.current.name === 'deck') {
        setNotice(`${message}. You can still export or download this deck, but Save is unavailable.`);
      } else {
        setError(message);
        setScreen({ name: 'home' });
      }
    };
    const onTakeover = () => {
      takenOver.current = true;
      setSession(null); // keep localStorage: the new tab owns that session
      setBusy(false);
      setNotice(null);
      setError('This draft was opened in another tab.');
      setScreen({ name: 'home' });
    };
    const onConnect = async () => {
      if (takenOver.current) return;
      const s = loadSession();
      if (!s) return;
      try {
        const res = await socket.timeout(10_000).emitWithAck('room:resume', { code: s.code, token: s.token });
        if (!res.ok) onError({ message: res.message });
        else remember({ code: res.code, playerId: res.playerId, token: s.token });
      } catch {
        // no answer: Socket.IO reconnects and 'connect' fires again
      }
    };

    socket.on('room:lobby', onLobby);
    socket.on('draft:state', onState);
    socket.on('draft:complete', onComplete);
    socket.on('room:error', onError);
    socket.on('room:takeover', onTakeover);
    socket.on('connect', onConnect);
    if (socket.connected) onConnect();
    return () => {
      socket.off('room:lobby', onLobby);
      socket.off('draft:state', onState);
      socket.off('draft:complete', onComplete);
      socket.off('room:error', onError);
      socket.off('room:takeover', onTakeover);
      socket.off('connect', onConnect);
    };
  }, []);

  const enter = async (request: Promise<Ack<SessionInfo>>) => {
    takenOver.current = false;
    setBusy(true);
    setError(null);
    try {
      const res = await request;
      setBusy(false);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      remember({ code: res.code, playerId: res.playerId, token: res.token });
      try {
        history.replaceState(null, '', location.pathname);
      } catch {
        // ignore
      }
    } catch {
      setBusy(false);
      setError('The draft server did not respond.');
    }
  };

  const createRoom = (name: string, setCode: string, timerSeconds: number | null, practice: boolean) => {
    saveName(name);
    enter(socket.timeout(30_000).emitWithAck('room:create', { name, setCode, timerSeconds, practice }));
  };

  const joinRoom = (name: string, code: string) => {
    saveName(name);
    enter(socket.timeout(10_000).emitWithAck('room:join', { code, name }));
  };

  const leave = () => {
    socket.emit('room:leave', {}, () => {});
    remember(null);
    setNotice(null);
    setError(null);
    setScreen({ name: 'home' });
  };

  if (screen.name === 'lobby') {
    // The lobby event can arrive just before the create/join ack that stores the session.
    if (!session) return <main className="home"><p className="muted">Joining…</p></main>;
    return <Lobby lobby={screen.lobby} playerId={session.playerId} onLeave={leave} />;
  }
  if (screen.name === 'draft') return <Draft state={screen.state} />;
  if (screen.name === 'deck') return <Deckbuilder pool={screen.pool} onNewDraft={leave} notice={notice} />;
  return (
    <Home
      busy={busy}
      error={error}
      initialName={loadName()}
      initialCode={roomCodeFromUrl(location.search)}
      onCreate={createRoom}
      onJoin={joinRoom}
    />
  );
}
