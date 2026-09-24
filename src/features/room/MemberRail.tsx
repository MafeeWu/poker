import type { RoomSnapshot } from '../../lib/roomApi';

export function MemberRail({ snapshot }: { snapshot: RoomSnapshot }) {
  return (
    <aside>
      <h2>Members</h2>
      <ul>
        {snapshot.members.map((member) => (
          <li key={member.id}>
            <strong>{member.nickname}</strong>
            <span> · {member.role}</span>
            <span>{member.online ? ' online' : ' offline'}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
