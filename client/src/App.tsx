import { useEffect, useRef, useState } from 'react';
import type { Ack, Card, DraftStatePayload, GameView, IncomingChallenge, LobbyView, RosterPlayer, SessionInfo } from '@mtg/shared';
import { RoomPanel } from './components/RoomPanel';
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
  | { name: 'deck'; pool: Card[] }
  | { name: 'game'; view: GameView };

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [session, setSession] = useState<SessionInfo | null>(() => loadSession());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [roster, setRoster] = useState<RosterPlayer[] | null>(null);
  const [incoming, setIncoming] = useState<IncomingChallenge | null>(null);
  const [battleStatus, setBattleStatus] = useState<string | null>(null);
  const poolRef = useRef<Card[]>([]);
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
      poolRef.current = pool;
      setNotice(null);
      setScreen((s) => (s.name === 'deck' || s.name === 'game' ? s : { name: 'deck', pool }));
    };
    const backToDeck = () => setScreen({ name: 'deck', pool: poolRef.current });
    const onRoster = ({ players }: { players: RosterPlayer[] }) => {
      setRoster(players);
      setIncoming(null); // a still-pending challenge is re-sent right after the roster
      const you = players.find((p) => p.isYou);
      if (screenRef.current.name === 'game' && you && !you.inGame) backToDeck();
    };
    const onChallenged = (c: IncomingChallenge) => setIncoming(c);
    const onDeclined = ({ byName, reason }: { byName: string; reason: 'declined' | 'expired' }) =>
      setBattleStatus(reason === 'expired' ? `Challenge to ${byName} expired` : `${byName} declined`);
    const onGameState = (view: GameView) => {
      setIncoming(null);
      setScreen({ name: 'game', view });
    };
    const onGameEnded = () => {
      if (screenRef.current.name === 'game') backToDeck();
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
    socket.on('battle:roster', onRoster);
    socket.on('battle:challenged', onChallenged);
    socket.on('battle:declined', onDeclined);
    socket.on('game:state', onGameState);
    socket.on('game:ended', onGameEnded);
    socket.on('room:error', onError);
    socket.on('room:takeover', onTakeover);
    socket.on('connect', onConnect);
    if (socket.connected) onConnect();
    return () => {
      socket.off('room:lobby', onLobby);
      socket.off('draft:state', onState);
      socket.off('draft:complete', onComplete);
      socket.off('battle:roster', onRoster);
      socket.off('battle:challenged', onChallenged);
      socket.off('battle:declined', onDeclined);
      socket.off('game:state', onGameState);
      socket.off('game:ended', onGameEnded);
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
    setRoster(null);
    setIncoming(null);
    setBattleStatus(null);
    poolRef.current = [];
    setScreen({ name: 'home' });
  };

  const challenge = async (playerId: string) => {
    setBattleStatus(null);
    try {
      const res = await socket.timeout(10_000).emitWithAck('battle:challenge', { playerId });
      setBattleStatus(res.ok ? 'Challenge sent' : res.message);
    } catch {
      setBattleStatus('The server did not respond.');
    }
  };

  const respond = async (accept: boolean) => {
    setIncoming(null);
    setBattleStatus(null);
    try {
      const res = await socket.timeout(10_000).emitWithAck('battle:respond', { accept });
      if (!res.ok) setBattleStatus(res.message);
    } catch {
      setBattleStatus('The server did not respond.');
    }
  };

  if (screen.name === 'lobby') {
    // The lobby event can arrive just before the create/join ack that stores the session.
    if (!session) return <main className="home"><p className="muted">Joining…</p></main>;
    return <Lobby lobby={screen.lobby} playerId={session.playerId} onLeave={leave} />;
  }
  if (screen.name === 'draft') return <Draft state={screen.state} />;
  if (screen.name === 'deck') {
    const panel = roster && (
      <RoomPanel roster={roster} incoming={incoming} onChallenge={challenge} onRespond={respond} status={battleStatus} />
    );
    return <Deckbuilder pool={screen.pool} onNewDraft={leave} notice={notice} roomPanel={panel} />;
  }
  if (screen.name === 'game') return <p>Game in progress (Task 7)</p>;
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
