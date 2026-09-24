import type { RoomSnapshot } from '../../lib/roomApi';

export function RoomHeader({ snapshot }: { snapshot: RoomSnapshot }) {
  return (
    <header>
      <p>{snapshot.room.name}</p>
      <h1>Room {snapshot.room.code}</h1>
    </header>
  );
}
