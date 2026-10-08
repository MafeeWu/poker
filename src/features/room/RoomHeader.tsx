import { StatusPill } from '../../components/StatusPill';
import type { RoomSnapshot } from '../../lib/roomApi';

export function RoomHeader({ snapshot }: { snapshot: RoomSnapshot }) {
  return (
    <header className="room-header">
      <div>
        <p>{snapshot.room.name}</p>
        <h1>Room <span data-testid="room-code">{snapshot.room.code}</span></h1>
      </div>
      <div className="meta">
        <StatusPill tone="warning">{snapshot.round.status}</StatusPill>
        <StatusPill tone="neutral">
          <span data-testid="member-count">{snapshot.members.length} members</span>
        </StatusPill>
      </div>
    </header>
  );
}
