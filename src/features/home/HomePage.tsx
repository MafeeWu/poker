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
        <div className="home-brand">
          <img className="brand-joker" src="/joker.svg" alt="" />
          <div>
            <h1 className="home-title">
              <span className="sr-only">Poker</span>
              <img src="/poker-wordmark.svg" alt="" />
            </h1>
            <p className="brand-caption">A LITTLE PLAY. A BETTER PLAN.</p>
          </div>
        </div>
        <div className="home-actions">
          <StatusPill tone="warning">Lucky Table</StatusPill>
          <StatusPill tone="neutral">Guest access</StatusPill>
        </div>
      </header>

      <div className="home-layout">
        <section className="home-hero" aria-label="Planning poker">
          <div className="hero-copy">
            <p className="home-kicker"><span aria-hidden="true">♦</span> SHUFFLE UP YOUR SPRINT</p>
            <p className="home-tagline">Big estimates.<br /><span>Better conversations.</span></p>
            <p className="home-description">Bring your team to the table. Pick a card, reveal together, and turn a little discussion into a shared estimate.</p>
          </div>
          <div className="home-card-fan" data-testid="home-card-fan" aria-hidden="true">
            <span className="home-fan-card"><span>♣</span><strong>3</strong><span>♣</span></span>
            <span className="home-fan-card"><span>♦</span><strong>5</strong><span>♦</span></span>
            <span className="home-fan-card home-joker-card">
              <span>★ <small>JOKER</small></span>
              <img src="/joker.svg" alt="" />
              <span>★</span>
            </span>
          </div>
          <div className="hero-footer">
            <span><span aria-hidden="true">♠</span> No sign-up needed</span>
            <span><span aria-hidden="true">♥</span> Every voice counts</span>
          </div>
        </section>

        <section className="home-panel entry-panel" aria-label="Room entry">
          <div className="panel-heading">
            <span className="eyebrow">YOUR NEXT GOOD CONVERSATION</span>
            <h2>{mode === 'create' ? 'Start a new table.' : 'Pull up a chair.'}</h2>
            <p>{mode === 'create' ? 'A name, a nickname, and you are in.' : 'Have a room code? Your team is waiting.'}</p>
          </div>
          <div className="entry-modes" role="group" aria-label="Room entry mode">
            <button type="button" className="action-button" aria-pressed={mode === 'create'} disabled={isEntryPending} onClick={() => setMode('create')}>
              Create project
            </button>
            <button type="button" className="action-button" aria-pressed={mode === 'join'} disabled={isEntryPending} onClick={() => setMode('join')}>
              Join project
            </button>
          </div>
          <RoomEntryForm mode={mode} onSuccess={handleSuccess} onPendingChange={setIsEntryPending} />
          <p className="entry-footnote">Private votes. Shared understanding.</p>
        </section>
      </div>

      <section className="home-panel recent-panel">
        <div className="recent-heading">
          <h2>Recent rooms</h2>
          <span className="eyebrow">BACK TO THE TABLE</span>
        </div>
        {recentRooms.length === 0 ? (
          <div className="recent-empty">
            <span className="empty-suit" aria-hidden="true">♣</span>
            <div><p>No recent rooms yet.</p><p className="recent-hint">Your next table will be waiting here.</p></div>
          </div>
        ) : (
          <ul className="recent-room-list">
            {recentRooms.map((room) => (
              <li key={`${room.code}-${room.memberId}`}>
                <button type="button" onClick={() => navigateToRoom(room.code)}>
                  <span className="recent-room-suit" aria-hidden="true">♠</span>
                  <span className="recent-room-info"><strong>{room.roomName}</strong><span>{room.code}</span></span>
                  <span className="recent-room-arrow" aria-hidden="true">↗</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <footer className="home-footer"><span>GOOD CARDS. GREAT CONVERSATIONS.</span><span aria-hidden="true">♠ ♥ ♣ ♦</span></footer>
    </main>
  );
}
