import { useState } from 'react';
import type { RoomSnapshot } from '../../lib/roomApi';
import { createRoom, joinRoom } from '../../lib/roomApi';

export type RoomEntryFormProps = {
  mode: 'create' | 'join';
  onSuccess: (snapshot: RoomSnapshot) => void;
  initialRoomCode?: string;
  onPendingChange?: (pending: boolean) => void;
};

export function RoomEntryForm({ mode, onSuccess, initialRoomCode = '', onPendingChange }: RoomEntryFormProps) {
  const [nickname, setNickname] = useState('');
  const [projectName, setProjectName] = useState('');
  const [roomCode, setRoomCode] = useState(initialRoomCode);
  const [role, setRole] = useState<'voter' | 'observer'>('voter');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitLabel = isSubmitting ? (mode === 'create' ? 'Creating…' : 'Joining…') : (mode === 'create' ? 'Create' : 'Join');

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    if (!nickname.trim()) {
      setError('Nickname is required');
      return;
    }

    const normalizedCode = roomCode.trim().toUpperCase();
    if (mode === 'join' && normalizedCode.length !== 8) {
      setError('8-character room code is required');
      return;
    }

    setError(null);
    setIsSubmitting(true);
    onPendingChange?.(true);
    try {
      const snapshot = mode === 'join'
        ? await joinRoom(normalizedCode, nickname.trim(), role)
        : await createRoom(projectName.trim() || 'Planning room', nickname.trim());
      onSuccess(snapshot);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : `Unable to ${mode} room`);
    } finally {
      setIsSubmitting(false);
      onPendingChange?.(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="entry-form" aria-busy={isSubmitting}>
      {mode === 'create' ? (
        <label>
          Project name
          <input
            type="text"
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
            placeholder="Planning room"
            disabled={isSubmitting}
          />
        </label>
      ) : (
        <label>
          Room code
          <input
            type="text"
            value={roomCode}
            onChange={(event) => setRoomCode(event.target.value)}
            placeholder="AB12CD34"
            disabled={isSubmitting}
          />
        </label>
      )}

      <label>
        Nickname
        <input
          type="text"
          value={nickname}
          onChange={(event) => setNickname(event.target.value)}
          placeholder="Mina"
          disabled={isSubmitting}
        />
      </label>

      {mode === 'join' && (
        <fieldset disabled={isSubmitting}>
          <legend>Role</legend>
          <div className="role-row">
            <label className="role-option">
              <input
                type="radio"
                name="room-role"
                value="voter"
                checked={role === 'voter'}
                onChange={() => setRole('voter')}
              />
              Voter
            </label>
            <label className="role-option">
              <input
                type="radio"
                name="room-role"
                value="observer"
                checked={role === 'observer'}
                onChange={() => setRole('observer')}
              />
              Observer
            </label>
          </div>
        </fieldset>
      )}

      {error ? <p role="alert" data-testid={mode === 'join' ? 'join-error' : undefined}>{error}</p> : null}

      <button type="submit" className="action-button" disabled={isSubmitting} aria-busy={isSubmitting} aria-label={submitLabel}>
        {isSubmitting ? <span className="button-spinner" aria-hidden="true" /> : null}
        <span role="status">{submitLabel}</span>
      </button>
    </form>
  );
}
