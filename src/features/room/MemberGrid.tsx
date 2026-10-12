import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { MemberRecord, RoundRecord } from '../../lib/roomApi';
import type { VoteAnimationEvent } from '../../lib/roomSync';

type MemberGridProps = {
  members: MemberRecord[];
  roundStatus: RoundRecord['status'];
  roundId?: string;
  voteAnimations?: Record<string, VoteAnimationEvent>;
};

const SUITS = ['♠', '♥', '♣', '♦'] as const;

function memberSuit(memberId: string) {
  // Membership UUIDs are random; deriving the suit keeps it identical on every client.
  let hash = 0;
  for (const character of memberId) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return SUITS[hash % SUITS.length];
}

function MemberVoteFlip({ animationId, children }: { animationId?: string; children: ReactNode }) {
  const surface = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = surface.current;
    if (!element) return;
    element.classList.remove('is-shaking');
    if (animationId) {
      // Restart rapid revotes without remounting the card's reveal surface.
      void element.offsetWidth;
      element.classList.add('is-shaking');
    }
  }, [animationId]);
  return (
    <div ref={surface} className="member-vote-flip" onAnimationEnd={() => surface.current?.classList.remove('is-shaking')}>
      {children}
    </div>
  );
}

export function MemberGrid({ members, roundStatus, roundId, voteAnimations = {} }: MemberGridProps) {
  return (
    <section className="member-grid" aria-labelledby="member-grid-heading" data-testid="member-grid">
      <h2 id="member-grid-heading">Members</h2>
      <ul className="member-card-grid">
        {members.map((member) => {
          const isObserver = member.role === 'observer';
          const voteStatus = isObserver ? 'observer' : member.hasVoted ? 'voted' : 'pending';
          const revealedVote = !isObserver && roundStatus !== 'voting' ? member.vote : null;
          const stateLabel = isObserver ? 'Observer' : member.hasVoted ? 'Voted' : 'Waiting';
          const cardState = !isObserver && member.hasVoted ? 'voted' : !member.online ? 'offline' : voteStatus;
          const animation = voteAnimations[member.id];
          const animationId = !isObserver && roundStatus === 'voting' && animation?.roundId === roundId ? animation?.eventId : undefined;

          return (
            <li
              key={member.id}
              className={'member-card member-card--' + voteStatus}
              data-testid={'member-card-' + member.id}
              data-vote-status={voteStatus}
              data-card-state={cardState}
              aria-label={`${member.nickname}, ${member.role}, ${member.online ? 'Online' : 'Offline'}, ${stateLabel}${revealedVote !== null ? `, vote ${revealedVote}` : ''}`}
            >
              <MemberVoteFlip animationId={animationId}>
                <div className={'member-vote-inner' + (revealedVote !== null ? ' is-revealed' : '')}>
                  <div
                    className="member-vote-card member-vote-card--back"
                    data-testid={revealedVote === null ? 'member-card-back' : undefined}
                    aria-hidden="true"
                  >{memberSuit(member.id)}</div>
                  {revealedVote !== null ? (
                    <div className="member-vote-card member-vote-card--front" data-testid="member-card-front">
                      <span>{revealedVote}</span>
                    </div>
                  ) : null}
                </div>
                {member.role === 'host' ? (
                  <span className="member-host-badge" role="img" aria-label="Host">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M3 6l5 4 4-7 4 7 5-4-2 12H5L3 6zm2 14h14" />
                    </svg>
                  </span>
                ) : null}
              </MemberVoteFlip>
              <strong className="member-name">{member.nickname}</strong>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
