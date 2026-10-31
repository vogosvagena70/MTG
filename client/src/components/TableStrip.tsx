import type { TableSeat } from '@mtg/shared';

export function TableStrip({ table }: { table: TableSeat[] }) {
  return (
    <ol className="table-strip" aria-label="Seats in passing order">
      {table.map((seat, i) => {
        const cls = ['seat', seat.isYou && 'you', seat.picked && 'picked', !seat.connected && 'offline', seat.isBot && 'bot']
          .filter(Boolean)
          .join(' ');
        return (
          <li key={i} className={cls} title={seat.connected ? undefined : 'Disconnected: picks are made automatically'}>
            {seat.name}
            {seat.picked && <span aria-label="picked"> ✓</span>}
          </li>
        );
      })}
    </ol>
  );
}
