import { useState } from 'react';
import type { RoomSnapshot } from '../../lib/roomApi';
import { createRoom, joinRoom } from '../../lib/roomApi';

export type RoomEntryFormProps = {
  mode: 'create' | 'join';
  onSuccess: (snapshot: RoomSnapshot) => void;
};

export function RoomEntryForm({ mode, onSuccess }: RoomEntryFormProps) {
  const [nickname, setNickname] = useState('');
  const [projectName, setProjectName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [role, setRole] = useState<'voter' | 'observer'>('voter');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!nickname.trim()) {
      setError('Nickname is required');
      return;
    }

    if (mode === 'join') {
      const normalizedCode = roomCode.trim().toUpperCase();
      if (normalizedCode.length !== 8) {
        setError('8-character room code is required');
        return;
      }

      try {
        setError(null);
        const snapshot = await joinRoom(normalizedCode, nickname.trim(), role);
        onSuccess(snapshot);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : 'Unable to join room');
      }
      return;
    }

    try {
      setError(null);
      const snapshot = await createRoom(projectName.trim() || 'Planning room', nickname.trim());
      onSuccess(snapshot);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to create room');
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {mode === 'create' ? (
        <label>
          Project name
          <input
            type="text"
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
            placeholder="Planning room"
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
        />
      </label>

      {mode === 'join' && (
        <fieldset>
          <legend>Role</legend>
          <label>
            <input
              type="radio"
              name="room-role"
              value="voter"
              checked={role === 'voter'}
              onChange={() => setRole('voter')}
            />
            Voter
          </label>
          <label>
            <input
              type="radio"
              name="room-role"
              value="observer"
              checked={role === 'observer'}
              onChange={() => setRole('observer')}
            />
            Observer
          </label>
        </fieldset>
      )}

      {error ? <p role="alert">{error}</p> : null}

      <button type="submit">{mode === 'create' ? 'Create' : 'Join'}</button>
    </form>
  );
}
