import { useCallback, useEffect, useState } from 'react';
import type { SetInfo } from '@mtg/shared';
import { socket } from '../socket';

interface Props {
  onStart: (setCode: string) => void;
  starting: boolean;
  error: string | null;
}

export function Home({ onStart, starting, error }: Props) {
  const [sets, setSets] = useState<SetInfo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [code, setCode] = useState('');

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await socket.timeout(15_000).emitWithAck('sets:list');
      if (res.ok) {
        setSets(res.sets);
        setCode((c) => c || res.sets[0]?.code || '');
      } else {
        setLoadError(res.message);
      }
    } catch {
      setLoadError('The draft server did not respond.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <main className="home">
      <h1>MTG Practice Draft</h1>
      <p className="muted">Draft a real set against 7 bots, then build a deck from your picks.</p>

      {loadError && (
        <div className="error">
          <span>{loadError}</span>
          <button className="btn" onClick={load}>Retry</button>
        </div>
      )}
      {error && (
        <div className="error">
          <span>{error}</span>
          <button className="btn" onClick={() => onStart(code)} disabled={!code || starting}>Retry</button>
        </div>
      )}

      <label>
        <div className="muted" style={{ marginBottom: 6 }}>Set</div>
        <select value={code} onChange={(e) => setCode(e.target.value)} disabled={!sets || starting}>
          {!sets && <option>Loading sets…</option>}
          {sets?.map((s) => (
            <option key={s.code} value={s.code}>
              {s.name} ({s.code.toUpperCase()}) · {s.releasedAt.slice(0, 4)}
            </option>
          ))}
        </select>
      </label>

      <button className="btn btn-primary" onClick={() => onStart(code)} disabled={!code || starting}>
        {starting ? 'Opening packs… (first load of a set can take a few seconds)' : 'Start practice draft'}
      </button>
    </main>
  );
}
