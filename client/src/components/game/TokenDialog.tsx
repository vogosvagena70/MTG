import { useEffect, useState, type FormEvent } from 'react';

const NAME_MAX = 30;
const DESCRIPTION_MAX = 300;
const PT_MAX = 3;

export interface TokenFields {
  name: string;
  description: string;
  power: string;
  toughness: string;
}

interface Props {
  initial: TokenFields;
  onCreate: (fields: TokenFields) => void;
  onCancel: () => void;
}

export function TokenDialog({ initial, onCreate, onCancel }: Props) {
  const [fields, setFields] = useState(initial);
  const set = (key: keyof TokenFields) => (e: { target: { value: string } }) =>
    setFields((f) => ({ ...f, [key]: e.target.value }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const hasPower = fields.power.trim() !== '';
  const hasToughness = fields.toughness.trim() !== '';
  const ok = fields.name.trim() !== '' && hasPower === hasToughness;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ok) onCreate(fields);
  };

  return (
    <div className="dialog-backdrop">
      <form className="token-dialog panel" aria-label="Create token" onSubmit={submit}>
        <h2>Create token</h2>
        <label>
          <div className="muted label">Title</div>
          <input autoFocus value={fields.name} maxLength={NAME_MAX} onChange={set('name')} />
        </label>
        <label>
          <div className="muted label">Description</div>
          <textarea rows={3} value={fields.description} maxLength={DESCRIPTION_MAX} onChange={set('description')} />
        </label>
        <div className="token-dialog-stats">
          <label>
            <div className="muted label">Power (optional)</div>
            <input value={fields.power} maxLength={PT_MAX} onChange={set('power')} />
          </label>
          <label>
            <div className="muted label">Toughness (optional)</div>
            <input value={fields.toughness} maxLength={PT_MAX} onChange={set('toughness')} />
          </label>
        </div>
        {hasPower !== hasToughness && <p className="warn">Enter both power and toughness, or leave both empty.</p>}
        <div className="token-dialog-actions">
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!ok}>Create</button>
        </div>
      </form>
    </div>
  );
}
