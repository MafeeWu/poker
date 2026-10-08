import type { MemberRecord, RoundRecord } from '../../lib/roomApi';

type MemberGridProps = {
  members: MemberRecord[];
  roundStatus: RoundRecord['status'];
};

export function MemberGrid({ members, roundStatus }: MemberGridProps) {
  return (
    <section className="member-grid" aria-labelledby="member-grid-heading" data-testid="member-grid">
      <h2 id="member-grid-heading">Members</h2>
      <ul className="member-card-grid">
        {members.map((member) => {
          const isObserver = member.role === 'observer';
          const voteStatus = isObserver ? 'observer' : member.hasVoted ? 'voted' : 'pending';
          const revealedVote = roundStatus !== 'voting' ? member.vote : null;
          const stateLabel = isObserver ? 'Observer' : member.hasVoted ? 'Voted' : 'Waiting';

          return (
            <li
              key={member.id}
              className={'member-card member-card--' + voteStatus}
              data-testid={'member-card-' + member.id}
              data-vote-status={voteStatus}
            >
              <div className="member-card-heading">
                <strong>{member.nickname}</strong>
                <span className="member-role">{member.role}</span>
              </div>
              <div className="member-card-meta">
                <span className="member-online-status">{member.online ? 'Online' : 'Offline'}</span>
                <span className="member-vote-status">{stateLabel}</span>
              </div>
              {!isObserver && roundStatus === 'voting' ? (
                <div className="member-vote-card member-vote-card--back" data-testid="member-card-back" aria-hidden="true">♠</div>
              ) : null}
              {!isObserver && roundStatus !== 'voting' && revealedVote !== null ? (
                <div className="member-vote-card member-vote-card--front" data-testid="member-card-front">
                  <span>{revealedVote}</span>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
