import { useCallback, useEffect, useState } from 'react';
import { TIMER_OPTIONS, type SetInfo } from '@mtg/shared';
import { socket } from '../socket';

interface Props {
  busy: boolean;
  error: string | null;
  initialName: string;
  initialCode: string;
  onCreate: (name: string, setCode: string, timerSeconds: number | null, practice: boolean) => void;
  onJoin: (name: string, code: string) => void;
  onTestTable: (name: string, setCode: string) => void;
}

export function Home({ busy, error, initialName, initialCode, onCreate, onJoin, onTestTable }: Props) {
  const [sets, setSets] = useState<SetInfo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [setCode, setSetCode] = useState('');
  const [name, setName] = useState(initialName);
  const [timer, setTimer] = useState<number | null>(60);
  const [code, setJoinCode] = useState(initialCode);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await socket.timeout(15_000).emitWithAck('sets:list');
      if (res.ok) {
        setSets(res.sets);
        setSetCode((c) => c || res.sets[0]?.code || '');
      } else {
        setLoadError(res.message);
      }
    } catch {
      setLoadError('The draft server did not respond. (On a free host the first visit can take a minute to wake up.)');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const nameOk = name.trim().length > 0;
  const canCreate = nameOk && !!setCode && !busy;
  const canJoin = nameOk && code.length === 4 && !busy;

  return (
    <main className="home">
      <h1>MTG Draft</h1>
      <p className="muted">Draft real Magic sets with friends, or practice against bots.</p>

      {loadError && (
        <div className="error">
          <span>{loadError}</span>
          <button className="btn" onClick={load}>Retry</button>
        </div>
      )}
      {error && <div className="error"><span>{error}</span></div>}

      <label>
        <div className="muted label">Your name</div>
        <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sam" disabled={busy} />
      </label>

      <section className="panel">
        <h2>Join a friend</h2>
        <div className="home-row">
          <input
            className="code-input"
            value={code}
            maxLength={4}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            placeholder="CODE"
            autoFocus={initialCode.length > 0}
            disabled={busy}
          />
          <button className="btn btn-primary" onClick={() => onJoin(name.trim(), code)} disabled={!canJoin}>Join room</button>
        </div>
      </section>

      <section className="panel">
        <h2>Start a draft</h2>
        <label>
          <div className="muted label">Set</div>
          <select value={setCode} onChange={(e) => setSetCode(e.target.value)} disabled={!sets || busy}>
            {!sets && <option>Loading sets…</option>}
            {sets?.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name} ({s.code.toUpperCase()}) · {s.releasedAt.slice(0, 4)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <div className="muted label">Pick timer (rooms only)</div>
          <select
            value={timer === null ? 'off' : String(timer)}
            onChange={(e) => setTimer(e.target.value === 'off' ? null : Number(e.target.value))}
            disabled={busy}
          >
            {TIMER_OPTIONS.map((t) => (
              <option key={t} value={t}>{t} seconds</option>
            ))}
            <option value="off">Off</option>
          </select>
        </label>
        <div className="home-row">
          <button className="btn btn-primary" onClick={() => onCreate(name.trim(), setCode, timer, false)} disabled={!canCreate}>
            Create room
          </button>
          <button className="btn" onClick={() => onCreate(name.trim(), setCode, null, true)} disabled={!canCreate}>
            Practice vs bots
          </button>
          <button
            className="btn"
            onClick={() => onTestTable(name.trim(), setCode)}
            disabled={!setCode || busy}
            title="Jump straight to the game table with a random deck from this set"
          >
            Test table
          </button>
        </div>
        {busy && <p className="muted">Opening packs… the first load of a set can take a few seconds.</p>}
      </section>
    </main>
  );
}
