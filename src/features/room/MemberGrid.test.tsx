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
  it('renders host and voter names, roles, and online status', () => {
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
    expect(within(hostCard).getByText('host')).toBeInTheDocument();
    expect(within(hostCard).getByText('Online')).toBeInTheDocument();
    expect(within(voterCard).getByText('Ada')).toBeInTheDocument();
    expect(within(voterCard).getByText('voter')).toBeInTheDocument();
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
    expect(screen.getByText('Voted')).toBeVisible();
    expect(screen.getByTestId('member-card-member-pending')).toHaveAttribute('data-vote-status', 'pending');
    expect(screen.getByTestId('member-card-member-pending')).toHaveClass('member-card--pending');
    expect(screen.getByText('Waiting')).toBeVisible();
    expect(screen.getAllByTestId('member-card-back')).toHaveLength(2);
    expect(screen.queryByText('5')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('marks observers without rendering a voting card', () => {
    render(
      <MemberGrid
        members={[{ ...baseMember, role: 'observer', hasVoted: false }]}
        roundStatus="voting"
      />,
    );

    const observerCard = screen.getByTestId('member-card-member-voter');
    expect(observerCard).toHaveAttribute('data-vote-status', 'observer');
    expect(observerCard).toHaveClass('member-card--observer');
    expect(within(observerCard).getByText('Observer')).toBeVisible();
    expect(within(observerCard).queryByTestId('member-card-back')).not.toBeInTheDocument();
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
    rerender(<MemberGrid members={members} roundStatus="archived" />);
    expect(screen.queryByText('55')).not.toBeInTheDocument();
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
