import { useCallback, useState } from 'react';
import { TokenDialog, type TokenFields } from './TokenDialog';

interface Props {
  disabled: boolean;
  onToken: (fields: TokenFields) => void;
}

const EMPTY: TokenFields = { name: '', description: '', power: '', toughness: '' };

/** "Mechanics" button with a pop-up of extra game actions. */
export function MechanicsMenu({ disabled, onToken }: Props) {
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState(false);
  // the dialog reopens with the last token, so making several of the same one is quick
  const [last, setLast] = useState(EMPTY);
  const closeDialog = useCallback(() => setDialog(false), []);

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
