import { useCallback, useState } from 'react';
import { TokenDialog, type TokenFields } from './TokenDialog';

export type LookMechanic = 'scry' | 'surveil';

interface Props {
  disabled: boolean;
  onToken: (fields: TokenFields) => void;
  /** Look at the top `count` cards of your library for a scry or surveil. */
  onLook: (kind: LookMechanic, count: number) => void;
}

const EMPTY: TokenFields = { name: '', description: '', power: '', toughness: '' };
const MAX_LOOK = 99;

/** "Mechanics" button with a pop-up of extra game actions. */
export function MechanicsMenu({ disabled, onToken, onLook }: Props) {
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState(false);
  // the dialog reopens with the last token, so making several of the same one is quick
  const [last, setLast] = useState(EMPTY);
  const [counts, setCounts] = useState<Record<LookMechanic, string>>({ scry: '1', surveil: '1' });
  const closeDialog = useCallback(() => setDialog(false), []);

  const lookRow = (kind: LookMechanic, label: string) => {
    const n = Number(counts[kind]);
    const ok = counts[kind].trim() !== '' && Number.isInteger(n) && n >= 1 && n <= MAX_LOOK;
    const run = () => {
      if (!ok) return;
      setOpen(false);
      onLook(kind, n);
    };
    return (
      <div className="mechanics-row">
        <button type="button" role="menuitem" className="btn" disabled={!ok} onClick={run}>
          {label}
        </button>
        <input
          type="number"
          min={1}
          max={MAX_LOOK}
          value={counts[kind]}
          aria-label={`Cards to ${kind}`}
          onChange={(e) => setCounts({ ...counts, [kind]: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') run();
          }}
        />
      </div>
    );
  };

  return (
    <span className="mechanics">
      <button type="button" className="btn" disabled={disabled} aria-expanded={open} onClick={() => setOpen(!open)}>
        Mechanics
      </button>
      {open && !disabled && (
        <div className="mechanics-menu panel" role="menu">
          <button
            type="button"
            role="menuitem"
            className="btn"
            onClick={() => {
              setOpen(false);
              setDialog(true);
            }}
          >
            Token
          </button>
          {lookRow('scry', 'Scry')}
          {lookRow('surveil', 'Surveil')}
        </div>
      )}
      {dialog && !disabled && (
        <TokenDialog
          initial={last}
          onCancel={closeDialog}
          onCreate={(fields) => {
            setLast(fields);
            setDialog(false);
            onToken(fields);
          }}
        />
      )}
    </span>
  );
}
