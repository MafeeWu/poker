import { StatusPill } from '../../components/StatusPill';
import type { RoomSnapshot } from '../../lib/roomApi';

export function MemberRail({ snapshot }: { snapshot: RoomSnapshot }) {
  return (
    <aside className="member-rail">
      <h2>Members</h2>
      <ul className="member-list">
        {snapshot.members.map((member) => {
          const tone = member.role === 'host' ? 'warning' : member.role === 'observer' ? 'neutral' : 'success';
          return (
            <li key={member.id} className="member-item">
              <div>
                <strong>{member.nickname}</strong>
              </div>
              <div className="member-markers">
                <StatusPill tone={tone}>{member.role}</StatusPill>
                <span>{member.online ? 'online' : 'offline'}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
