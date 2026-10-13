import type { ReactNode } from 'react';
import { StatusPill } from '../../components/StatusPill';
import type { RoomSnapshot } from '../../lib/roomApi';

export function RoomHeader({ snapshot, children }: { snapshot: RoomSnapshot; children: ReactNode }) {
  return (
    <header className="room-header">
      <div className="room-identity">
        <a className="room-home-link" href="/" aria-label="Back to home"><img src="/joker.svg" alt="" /></a>
        <h1>{snapshot.room.name}</h1>
      </div>
      <div className="room-header-right">
        {children}
        <div className="meta">
          <StatusPill tone="warning">{snapshot.round.status}</StatusPill>
          <StatusPill tone="neutral">
            <span data-testid="member-count">{snapshot.members.length} members</span>
          </StatusPill>
        </div>
      </div>
    </header>
  );
}
