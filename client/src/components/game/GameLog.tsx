import { useState } from 'react';

export function GameLog({ log }: { log: { at: number; text: string }[] }) {
  const [open, setOpen] = useState(true);
  return (
    <aside className="game-log panel">
      <button type="button" className="btn" onClick={() => setOpen(!open)}>
        {open ? 'Hide log' : 'Show log'}
      </button>
      {open && (
        <ol>
          {[...log].reverse().map((l, i) => (
            <li key={log.length - i}>{l.text}</li>
          ))}
        </ol>
      )}
    </aside>
  );
}
