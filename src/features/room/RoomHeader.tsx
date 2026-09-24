import { StatusPill } from '../../components/StatusPill';
import type { RoomSnapshot } from '../../lib/roomApi';

export function RoomHeader({ snapshot }: { snapshot: RoomSnapshot }) {
  return (
    <header className="room-header">
      <div>
        <p>{snapshot.room.name}</p>
        <h1>Room {snapshot.room.code}</h1>
      </div>
      <div className="meta">
        <StatusPill tone="warning">{snapshot.round.status}</StatusPill>
        <StatusPill tone="neutral">{snapshot.members.length} members</StatusPill>
      </div>
    </header>
  );
}
