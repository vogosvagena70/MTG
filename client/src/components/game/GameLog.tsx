export function GameLog({ log, onClose }: { log: { at: number; text: string }[]; onClose: () => void }) {
  return (
    <aside className="game-log panel">
      <div className="row-between">
        <h2>Log</h2>
        <button type="button" className="btn" onClick={onClose} aria-label="Close log">×</button>
      </div>
      <ol>
        {[...log].reverse().map((l, i) => (
          <li key={log.length - i}>{l.text}</li>
        ))}
      </ol>
    </aside>
  );
}
