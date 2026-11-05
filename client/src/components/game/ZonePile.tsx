interface Props {
  label: string;
  count: number;
  onClick?: () => void;
  onContextMenu?: (x: number, y: number) => void;
  onDropCard?: (gid: string) => void;
  title?: string;
}

export function ZonePile({ label, count, onClick, onContextMenu, onDropCard, title }: Props) {
  return (
    <button
      type="button"
      className="pile"
      title={title}
      onClick={onClick}
      onContextMenu={
        onContextMenu
          ? (e) => {
              e.preventDefault();
              onContextMenu(e.clientX, e.clientY);
            }
          : undefined
      }
      onDragOver={onDropCard ? (e) => e.preventDefault() : undefined}
      onDrop={
        onDropCard
          ? (e) => {
              e.preventDefault();
              const gid = e.dataTransfer.getData('text/plain');
              if (gid) onDropCard(gid);
            }
          : undefined
      }
    >
      <span className="pile-count">{count}</span>
      <span className="pile-label">{label}</span>
    </button>
  );
}
