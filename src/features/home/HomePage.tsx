import { useMemo, useState } from 'react';
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
    <main>
      <h1>Poker</h1>
      <div>
        <button type="button" onClick={() => setMode('create')}>Create project</button>
        <button type="button" onClick={() => setMode('join')}>Join project</button>
      </div>

      <RoomEntryForm mode={mode} onSuccess={handleSuccess} />

      <section>
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
