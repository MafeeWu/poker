import { render, screen, within } from '@testing-library/react';
import { emptyDistribution } from '../../domain/poker';
import { VoteDistribution } from './VoteDistribution';

describe('VoteDistribution', () => {
  it('renders only positive Fibonacci counts with accessible labels and visible counts', () => {
    const distribution = emptyDistribution();
    distribution['5'] = 2;
    distribution['8'] = 1;

    render(<VoteDistribution distribution={distribution} />);

    const bars = screen.getByRole('group', { name: 'Vote distribution' });
    expect(within(bars).getAllByRole('img')).toHaveLength(2);
    expect(within(bars).getByRole('img', { name: '5 votes: 2' })).toBeInTheDocument();
    expect(within(bars).getByRole('img', { name: '8 votes: 1' })).toBeInTheDocument();
    expect(within(bars).getByRole('img', { name: '5 votes: 2' })).toHaveStyle({ height: '100%' });
    expect(within(bars).getByRole('img', { name: '8 votes: 1' })).toHaveStyle({ height: '50%' });
    expect(within(bars).getByText('2', { selector: '.distribution-count' })).toBeVisible();
    expect(within(bars).getByText('1', { selector: '.distribution-count' })).toBeVisible();
  });

  it('keeps positive values in Fibonacci deck order', () => {
    const distribution = emptyDistribution();
    distribution['½'] = 1;
    distribution['1'] = 2;
    distribution['?'] = 1;

    render(<VoteDistribution distribution={distribution} />);

    expect(screen.getAllByRole('img').map((bar) => bar.getAttribute('aria-label'))).toEqual([
      '½ votes: 1',
      '1 votes: 2',
      '? votes: 1',
    ]);
  });

  it('renders no chart when every vote count is zero', () => {
    render(<VoteDistribution distribution={emptyDistribution()} />);

    expect(screen.queryByRole('group', { name: 'Vote distribution' })).not.toBeInTheDocument();
  });

  it('renders no chart for a null distribution', () => {
    const { container } = render(<VoteDistribution distribution={null} />);

    expect(container).toBeEmptyDOMElement();
  });
});
