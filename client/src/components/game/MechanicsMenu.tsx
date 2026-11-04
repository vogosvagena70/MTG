import { useState, type KeyboardEvent } from 'react';

const MAX_SEARCH_TOP = 99;
const TOKEN_NAME_MAX = 30;
const TOKEN_PT_MAX = 3;

interface Props {
  disabled: boolean;
  libraryCount: number;
  onSearchTop: (count: number) => void;
  onSearchLibrary: () => void;
  onToken: (name: string, power: string, toughness: string) => void;
}

/** "Mechanics" button with a pop-up of extra game actions. */
export function MechanicsMenu({ disabled, libraryCount, onSearchTop, onSearchLibrary, onToken }: Props) {
  const [open, setOpen] = useState(false);
  const [topText, setTopText] = useState('1');
  const [tokenName, setTokenName] = useState('');
  const [power, setPower] = useState('1');
  const [toughness, setToughness] = useState('1');

  const count = Number(topText);
  const hasLibrary = libraryCount > 0;
  const topOk = Number.isInteger(count) && count >= 1 && count <= MAX_SEARCH_TOP && hasLibrary;
  const tokenOk = tokenName.trim() !== '' && power.trim() !== '' && toughness.trim() !== '';

  const searchTop = () => {
    if (!topOk) return;
    onSearchTop(count);
    setOpen(false);
  };
  const searchLibrary = () => {
    onSearchLibrary();
    setOpen(false);
  };
  const createToken = () => {
    if (!tokenOk) return;
    onToken(tokenName.trim(), power.trim(), toughness.trim());
    setOpen(false); // the form keeps its values, so making several of the same token is quick
  };
  const keys = (run: () => void) => (e: KeyboardEvent) => {
    if (e.key === 'Enter') run();
    if (e.key === 'Escape') setOpen(false);
  };

  return (
    <span className="mechanics">
      <button type="button" className="btn" disabled={disabled} aria-expanded={open} onClick={() => setOpen(!open)}>
        Mechanics
      </button>
      {open && !disabled && (
        <div className="mechanics-menu panel" role="menu">
          <div className="mechanics-row">
            <button type="button" className="btn" disabled={!topOk} onClick={searchTop}>Search top</button>
            <input
              type="number"
              min={1}
              max={MAX_SEARCH_TOP}
              value={topText}
              aria-label="Number of cards to search from the top of your library"
              onChange={(e) => setTopText(e.target.value)}
              onKeyDown={keys(searchTop)}
            />
          </div>
          <button type="button" className="btn" disabled={!hasLibrary} onClick={searchLibrary}>Search library</button>
          <div className="mechanics-token">
            <div className="muted label">Token</div>
            <input
              className="token-name-input"
              value={tokenName}
              maxLength={TOKEN_NAME_MAX}
              placeholder="Name, e.g. Goblin"
              aria-label="Token name"
              onChange={(e) => setTokenName(e.target.value)}
              onKeyDown={keys(createToken)}
            />
            <div className="mechanics-row">
              <input value={power} maxLength={TOKEN_PT_MAX} aria-label="Token power" onChange={(e) => setPower(e.target.value)} onKeyDown={keys(createToken)} />
              <span>/</span>
              <input value={toughness} maxLength={TOKEN_PT_MAX} aria-label="Token toughness" onChange={(e) => setToughness(e.target.value)} onKeyDown={keys(createToken)} />
              <button type="button" className="btn" disabled={!tokenOk} onClick={createToken}>Create</button>
            </div>
          </div>
        </div>
      )}
    </span>
  );
}
