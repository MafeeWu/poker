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
  const [isEntryPending, setIsEntryPending] = useState(false);
  const recentRooms = useMemo(() => readRecentRooms(), []);

  const handleSuccess = (snapshot: RoomSnapshot) => {
    saveRecentRoom(snapshot);
    navigateToRoom(snapshot.room.code);
  };

  return (
    <main className="home-shell" data-theme="arcade">
      <header className="home-header">
        <h1 className="home-title">Poker</h1>
        <div className="home-actions">
          <StatusPill tone="warning">Lucky Table</StatusPill>
          <StatusPill tone="neutral">Guest access</StatusPill>
        </div>
      </header>

      <section className="home-hero" aria-label="Planning poker">
        <div>
          <p className="home-kicker">SHUFFLE UP YOUR SPRINT</p>
          <p className="home-tagline">Big estimates.<br />Better conversations.</p>
        </div>
        <div className="home-card-fan" data-testid="home-card-fan" aria-hidden="true">
          <span className="home-fan-card">♣<strong>3</strong></span>
          <span className="home-fan-card">♦<strong>5</strong></span>
          <span className="home-fan-card">★<strong>8</strong></span>
        </div>
      </section>

      <div className="home-actions">
        <button type="button" className={mode === 'create' ? 'action-button' : 'action-button secondary'} disabled={isEntryPending} onClick={() => setMode('create')}>
          Create project
        </button>
        <button type="button" className={mode === 'join' ? 'action-button' : 'action-button secondary'} disabled={isEntryPending} onClick={() => setMode('join')}>
          Join project
        </button>
      </div>

      <section className="home-panel">
        <RoomEntryForm mode={mode} onSuccess={handleSuccess} onPendingChange={setIsEntryPending} />
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
