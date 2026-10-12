import { render, screen, within } from '@testing-library/react';
import type { MemberRecord } from '../../lib/roomApi';
import { MemberGrid } from './MemberGrid';

const baseMember: MemberRecord = {
  id: 'member-voter',
  nickname: 'Ada',
  role: 'voter',
  joinedAt: '2024-01-01T00:00:00.000Z',
  lastSeenAt: '2024-01-01T00:00:00.000Z',
  online: true,
  hasVoted: false,
  vote: null,
};

describe('MemberGrid', () => {
  it('places names below the cards and identifies only the host with a crown', () => {
    render(
      <MemberGrid
        members={[
          { ...baseMember, id: 'member-host', nickname: 'Grace', role: 'host' },
          baseMember,
        ]}
        roundStatus="voting"
      />,
    );

    const hostCard = screen.getByTestId('member-card-member-host');
    const voterCard = screen.getByTestId('member-card-member-voter');
    expect(within(hostCard).getByText('Grace')).toBeInTheDocument();
    expect(within(hostCard).getByRole('img', { name: 'Host' })).toBeInTheDocument();
    expect(within(voterCard).getByText('Ada')).toBeInTheDocument();
    expect(within(voterCard).queryByRole('img', { name: 'Host' })).not.toBeInTheDocument();
    expect(hostCard).toHaveAccessibleName(/Grace.*host.*online.*waiting/i);
    expect(voterCard).toHaveAccessibleName(/Ada.*voter.*online.*waiting/i);
    expect(screen.queryByText(/^(host|voter|Online|Offline|Waiting|Voted)$/i)).not.toBeInTheDocument();
    const back = within(hostCard).getByTestId('member-card-back');
    expect(back.compareDocumentPosition(within(hostCard).getByText('Grace')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows voted and waiting states without exposing submitted vote values', () => {
    render(
      <MemberGrid
        members={[{ ...baseMember, hasVoted: true, vote: '5' }, { ...baseMember, id: 'member-pending' }]}
        roundStatus="voting"
      />,
    );

    expect(screen.getByTestId('member-card-member-voter')).toHaveAttribute('data-vote-status', 'voted');
    expect(screen.getByTestId('member-card-member-voter')).toHaveClass('member-card--voted');
    expect(screen.getByTestId('member-card-member-voter')).toHaveAttribute('data-card-state', 'voted');
    expect(screen.getByTestId('member-card-member-pending')).toHaveAttribute('data-vote-status', 'pending');
    expect(screen.getByTestId('member-card-member-pending')).toHaveClass('member-card--pending');
    expect(screen.getByTestId('member-card-member-pending')).toHaveAttribute('data-card-state', 'pending');
    expect(screen.queryByText(/^(Voted|Waiting)$/)).not.toBeInTheDocument();
    expect(screen.getAllByTestId('member-card-back')).toHaveLength(2);
    expect(screen.queryByText('5')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows observers as non-voting backs without visible role text', () => {
    render(
      <MemberGrid
        members={[{ ...baseMember, role: 'observer', hasVoted: false }]}
        roundStatus="voting"
      />,
    );

    const observerCard = screen.getByTestId('member-card-member-voter');
    expect(observerCard).toHaveAttribute('data-vote-status', 'observer');
    expect(observerCard).toHaveClass('member-card--observer');
    expect(observerCard).toHaveAttribute('data-card-state', 'observer');
    expect(observerCard).toHaveAccessibleName(/observer/i);
    expect(within(observerCard).queryByText('Observer')).not.toBeInTheDocument();
    expect(within(observerCard).getByTestId('member-card-back')).toBeInTheDocument();
  });

  it('shows each voter’s own vote only after reveal', () => {
    render(
      <MemberGrid
        members={[
          { ...baseMember, hasVoted: true, vote: '5' },
          { ...baseMember, id: 'member-other', nickname: 'Lin', vote: '8' },
        ]}
        roundStatus="revealed"
      />,
    );

    expect(within(screen.getByTestId('member-card-member-voter')).getByTestId('member-card-front')).toHaveTextContent('5');
    expect(within(screen.getByTestId('member-card-member-other')).getByTestId('member-card-front')).toHaveTextContent('8');
    expect(screen.queryByTestId('member-card-back')).not.toBeInTheDocument();
  });

  it('shows a submitted value when the round is archived', () => {
    render(
      <MemberGrid
        members={[{ ...baseMember, hasVoted: true, vote: '8' }]}
        roundStatus="archived"
      />,
    );

    expect(within(screen.getByTestId('member-card-member-voter')).getByTestId('member-card-front')).toHaveTextContent('8');
  });

  it('never mounts an observer value even in a revealed or archived snapshot', () => {
    const members: MemberRecord[] = [{ ...baseMember, role: 'observer', vote: '55', hasVoted: true }];
    const { rerender } = render(<MemberGrid members={members} roundStatus="revealed" />);
    expect(screen.queryByText('55')).not.toBeInTheDocument();
    expect(screen.queryByTestId('member-card-front')).not.toBeInTheDocument();
    expect(screen.getByTestId('member-card-back')).toBeInTheDocument();
    rerender(<MemberGrid members={members} roundStatus="archived" />);
    expect(screen.queryByText('55')).not.toBeInTheDocument();
  });

  it.each([
    { online: true, hasVoted: false, state: 'pending' },
    { online: true, hasVoted: true, state: 'voted' },
    { online: false, hasVoted: false, state: 'offline' },
    { online: false, hasVoted: true, state: 'voted' },
  ])('uses $state for online=$online and hasVoted=$hasVoted', ({ online, hasVoted, state }) => {
    render(<MemberGrid members={[{ ...baseMember, online, hasVoted }]} roundStatus="voting" />);
    const card = screen.getByTestId('member-card-member-voter');
    expect(card).toHaveAttribute('data-card-state', state);
    expect(card).toHaveAccessibleName(new RegExp(online ? '\\bonline\\b' : '\\boffline\\b', 'i'));
  });

  it('uses the offline background for a disconnected observer without exposing invalid votes', () => {
    render(<MemberGrid members={[{ ...baseMember, role: 'observer', online: false, hasVoted: true, vote: '55' }]} roundStatus="revealed" />);
    expect(screen.getByTestId('member-card-member-voter')).toHaveAttribute('data-card-state', 'offline');
    expect(screen.getByTestId('member-card-back')).toBeInTheDocument();
    expect(screen.queryByText('55')).not.toBeInTheDocument();
  });

  it('preserves revealed votes and the voted background after disconnecting', () => {
    render(<MemberGrid members={[{ ...baseMember, online: false, hasVoted: true, vote: '8' }]} roundStatus="revealed" />);
    expect(screen.getByTestId('member-card-member-voter')).toHaveAttribute('data-card-state', 'voted');
    expect(screen.getByTestId('member-card-front')).toHaveTextContent('8');
  });

  it('keeps member suits stable across reordering, status changes and remounts', () => {
    const members = Array.from({ length: 4 }, (_, index) => ({
      ...baseMember, id: `00000000-0000-4000-8000-00000000000${index}`, nickname: `Member ${index}`,
    }));
    const readSuits = () => members.map(({ id }) => within(screen.getByTestId(`member-card-${id}`)).getByTestId('member-card-back').textContent);
    const { rerender, unmount } = render(<MemberGrid members={members} roundStatus="voting" />);
    const suits = readSuits();
    expect(new Set(suits).size).toBe(4);
    for (const suit of suits) expect(['♠', '♥', '♣', '♦']).toContain(suit);
    rerender(<MemberGrid members={[...members].reverse().map((member) => ({ ...member, hasVoted: true, online: false }))} roundStatus="voting" />);
    expect(readSuits()).toEqual(suits);
    unmount();
    render(<MemberGrid members={members} roundStatus="revealed" />);
    expect(readSuits()).toEqual(suits);
  });

  it('preserves the same flip surface when a shaken vote is revealed', () => {
    const voteAnimations = {
      [baseMember.id]: { memberId: baseMember.id, roundId: 'round-1', eventId: 'animation-1' },
    };
    const { container, rerender } = render(
      <MemberGrid members={[{ ...baseMember, hasVoted: true }]} roundId="round-1" roundStatus="voting" voteAnimations={voteAnimations} />,
    );
    const flip = container.querySelector('.member-vote-flip');
    expect(flip).toHaveClass('is-shaking');
    rerender(<MemberGrid members={[{ ...baseMember, hasVoted: true, vote: '5' }]} roundId="round-1" roundStatus="revealed" voteAnimations={voteAnimations} />);
    expect(container.querySelector('.member-vote-flip')).toBe(flip);
    expect(flip).not.toHaveClass('is-shaking');
    expect(screen.getByTestId('member-card-front')).toHaveTextContent('5');
  });

  it('renders all 100 online members', () => {
    const members = Array.from({ length: 100 }, (_, index) => ({
      ...baseMember,
      id: 'member-' + index,
      nickname: 'Member ' + index,
      online: true,
    }));

    render(<MemberGrid members={members} roundStatus="voting" />);

    expect(screen.getAllByTestId(/^member-card-member-/)).toHaveLength(100);
  });
});
