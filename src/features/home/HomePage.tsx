import { useMemo, useState } from 'react';
import { StatusPill } from '../../components/StatusPill';
import type { RoomSnapshot } from '../../lib/roomApi';
import { readRecentRooms, saveRecentRoom } from '../room/roomCopy';
import { RoomEntryForm } from './RoomEntryForm';

function navigateToRoom(code: string): void {
  const nextPath = `/room/${code}`;
  window.history.pushState({}, '', nextPath);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function HomePage() {
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const recentRooms = useMemo(() => readRecentRooms(), []);

  const handleSuccess = (snapshot: RoomSnapshot) => {
    saveRecentRoom(snapshot);
    navigateToRoom(snapshot.room.code);
  };

  return (
    <main className="home-shell">
      <header className="home-header">
        <h1 className="home-title">Poker</h1>
        <div className="home-actions">
          <StatusPill tone="warning">Velvet Table</StatusPill>
          <StatusPill tone="neutral">Guest access</StatusPill>
        </div>
      </header>

      <div className="home-actions">
        <button type="button" className={mode === 'create' ? 'action-button' : 'action-button secondary'} onClick={() => setMode('create')}>
          Create project
        </button>
        <button type="button" className={mode === 'join' ? 'action-button' : 'action-button secondary'} onClick={() => setMode('join')}>
          Join project
        </button>
      </div>

      <section className="home-panel">
        <RoomEntryForm mode={mode} onSuccess={handleSuccess} />
      </section>

      <section className="home-panel">
        <h2>Recent rooms</h2>
        {recentRooms.length === 0 ? (
          <p>No recent rooms yet.</p>
        ) : (
          <ul>
            {recentRooms.map((room) => (
              <li key={`${room.code}-${room.memberId}`}>
                <button type="button" onClick={() => navigateToRoom(room.code)}>
                  {room.roomName} · {room.code}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
