import { useEffect, useState } from 'react';
import type { Card, SeatView } from '@mtg/shared';
import { socket } from './socket';
import { Home } from './screens/Home';

type Screen = { name: 'home' } | { name: 'draft'; view: SeatView } | { name: 'deck'; pool: Card[] };

const ROOM_KEY = 'mtg.practice.roomId';

function storeRoom(id: string | null) {
  try {
    if (id) sessionStorage.setItem(ROOM_KEY, id);
    else sessionStorage.removeItem(ROOM_KEY);
  } catch {
    /* storage unavailable: resume just won't work */
  }
}

function loadRoom(): string | null {
  try {
    return sessionStorage.getItem(ROOM_KEY);
  } catch {
    return null;
  }
}

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onState = ({ roomId, view }: { roomId: string; view: SeatView }) => {
      storeRoom(roomId);
      setStarting(false);
      setError(null);
      setScreen({ name: 'draft', view });
    };
    const onComplete = ({ roomId, pool }: { roomId: string; pool: Card[] }) => {
      storeRoom(roomId);
      setScreen((s) => (s.name === 'deck' ? s : { name: 'deck', pool }));
    };
    const onError = ({ message }: { message: string }) => {
      storeRoom(null);
      setStarting(false);
      setError(message);
      setScreen({ name: 'home' });
    };
    const onConnect = () => {
      const roomId = loadRoom();
      if (roomId) socket.emit('room:resume', { roomId });
    };

    socket.on('draft:state', onState);
    socket.on('draft:complete', onComplete);
    socket.on('practice:error', onError);
    socket.on('connect', onConnect);
    if (socket.connected) onConnect();
    return () => {
      socket.off('draft:state', onState);
      socket.off('draft:complete', onComplete);
      socket.off('practice:error', onError);
      socket.off('connect', onConnect);
    };
  }, []);

  const start = (setCode: string) => {
    setStarting(true);
    setError(null);
    socket.emit('practice:start', { setCode });
  };

  const newDraft = () => {
    storeRoom(null);
    setScreen({ name: 'home' });
  };

  if (screen.name === 'draft') return <p className="muted">Draft screen (Task 9) — pick {screen.view.pickNumber}</p>;
  if (screen.name === 'deck') return <button className="btn" onClick={newDraft}>Deckbuilder (Task 10) — new draft</button>;
  return <Home onStart={start} starting={starting} error={error} />;
}
