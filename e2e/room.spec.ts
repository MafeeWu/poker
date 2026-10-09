import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createRoom, joinExistingRoom } from './helpers';
import { createOnlineRoomFixture } from '../scripts/room-fixtures.mjs';

function memberCard(page: Page, nickname: string) {
  return page.getByTestId('member-grid').locator('li').filter({ hasText: nickname });
}

function voteCard(page: Page, value: string) {
  return page.getByRole('button', { name: value, exact: true });
}

async function expectVotesHidden(page: Page, nicknames: string[]) {
  const grid = page.getByTestId('member-grid');
  await expect(grid.locator('li')).toHaveCount(nicknames.length);
  await expect(grid.getByTestId('member-card-back')).toHaveCount(nicknames.length);
  await expect(grid.getByTestId('member-card-front')).toHaveCount(0);
  await expect(page.getByTestId('distribution-bars')).toHaveCount(0);
  for (const nickname of nicknames) {
    await expect(memberCard(page, nickname)).toHaveAttribute('data-vote-status', 'voted');
  }
}

async function expectRevealedVotes(page: Page, votes: { nickname: string; value: string }[]) {
  for (const { nickname, value } of votes) {
    await expect(memberCard(page, nickname).getByTestId('member-card-front')).toHaveText(value);
  }
}

async function expectDistribution(page: Page, labels: string[], counts: string[]) {
  const chart = page.getByTestId('distribution-bars');
  await expect(chart.locator('.distribution-label')).toHaveText(labels);
  await expect(chart.locator('.distribution-count')).toHaveText(counts);
}

test('three independent members complete two rounds without exposing votes before Reveal', async ({ browser }) => {
  let hostContext: BrowserContext | undefined;
  let voterOneContext: BrowserContext | undefined;
  let voterTwoContext: BrowserContext | undefined;
  try {
    hostContext = await browser.newContext();
    voterOneContext = await browser.newContext();
    voterTwoContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const voterOnePage = await voterOneContext.newPage();
    const voterTwoPage = await voterTwoContext.newPage();
    const pages = [hostPage, voterOnePage, voterTwoPage];
    const nicknames = ['Host User', 'Voter One', 'Voter Two'];
    const firstRoundVotes = [
      { nickname: 'Host User', value: '5' },
      { nickname: 'Voter One', value: '5' },
      { nickname: 'Voter Two', value: '3' },
    ];

    await createRoom(hostPage, 'Three member fixture', nicknames[0]);
    const code = await hostPage.getByTestId('room-code').textContent();
    if (!code) {
      throw new Error('Room creation did not render a room code.');
    }
    await joinExistingRoom(voterOnePage, code, nicknames[1], 'voter');
    await expect(hostPage.getByTestId('member-count')).toHaveText('2 members');
    await expect(voterOnePage.getByTestId('member-count')).toHaveText('2 members');
    await joinExistingRoom(voterTwoPage, code, nicknames[2], 'voter');
    for (const page of pages) {
      await expect(page.getByTestId('member-count')).toHaveText('3 members');
    }

    await voteCard(hostPage, '5').click();
    await voteCard(voterOnePage, '5').click();
    await voteCard(voterTwoPage, '3').click();
    for (const page of pages) {
      await expectVotesHidden(page, nicknames);
    }

    await hostPage.getByTestId('reveal-button').click();
    for (const page of pages) {
      await expect(page.getByTestId('round-status')).toHaveText(/revealed/i);
      await expectRevealedVotes(page, firstRoundVotes);
      await expectDistribution(page, ['3', '5'], ['1', '2']);
    }

    await expect(hostPage.getByLabel(/final estimate/i)).toHaveValue('5');
    await hostPage.getByLabel(/final estimate/i).fill('8');
    await hostPage.getByLabel('Note').click();
    for (const page of [voterOnePage, voterTwoPage]) {
      await expect(page.getByTestId('final-estimate-value')).toHaveText('Final estimate: 8');
    }
    await hostPage.getByLabel('Note').fill('Ship the smaller slice');
    await hostPage.getByRole('heading', { name: 'Round outcome' }).click();
    for (const page of [voterOnePage, voterTwoPage]) {
      await expect(page.getByTestId('current-round-note')).toHaveText('Note: Ship the smaller slice');
    }

    await hostPage.getByRole('button', { name: 'Next round' }).click();
    for (const page of pages) {
      await expect(page.getByTestId('round-board').getByRole('heading')).toHaveText('Round 2');
      await expect(page.getByTestId('round-status')).toHaveText(/waiting for votes/i);
      const history = page.getByRole('region', { name: 'Round history' });
      await expect(history).toContainText('Round 1');
      await expect(history).toContainText('Final estimate: 8');
      await expect(history).toContainText('Note: Ship the smaller slice');
    }

    const secondRoundVotes = [
      { nickname: 'Host User', value: '5' },
      { nickname: 'Voter One', value: '8' },
      { nickname: 'Voter Two', value: '13' },
    ];
    await voteCard(hostPage, '5').click();
    await voteCard(voterOnePage, '8').click();
    await voteCard(voterTwoPage, '13').click();
    for (const page of pages) {
      await expectVotesHidden(page, nicknames);
    }

    await hostPage.getByTestId('reveal-button').click();
    for (const page of pages) {
      await expect(page.getByTestId('round-status')).toHaveText(/revealed/i);
      await expectRevealedVotes(page, secondRoundVotes);
      await expectDistribution(page, ['5', '8', '13'], ['1', '1', '1']);
    }
    await expect(hostPage.getByLabel(/final estimate/i)).toHaveValue('');
    await expect(hostPage.getByText('Tied estimates: 5, 8, 13')).toBeVisible();
  } finally {
    await Promise.all([hostContext?.close(), voterOneContext?.close(), voterTwoContext?.close()]);
  }
});

test('a tied highest vote requires the host to enter an estimate before Next round', async ({ browser }) => {
  let hostContext: BrowserContext | undefined;
  let voterOneContext: BrowserContext | undefined;
  let voterTwoContext: BrowserContext | undefined;
  try {
    hostContext = await browser.newContext();
    voterOneContext = await browser.newContext();
    voterTwoContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const voterOnePage = await voterOneContext.newPage();
    const voterTwoPage = await voterTwoContext.newPage();
    const pages = [hostPage, voterOnePage, voterTwoPage];
    const nicknames = ['Tie Host', 'Tie Voter One', 'Tie Voter Two'];

    await createRoom(hostPage, 'Tie fixture', nicknames[0]);
    const code = await hostPage.getByTestId('room-code').textContent();
    if (!code) {
      throw new Error('Room creation did not render a room code.');
    }
    await joinExistingRoom(voterOnePage, code, nicknames[1], 'voter');
    await joinExistingRoom(voterTwoPage, code, nicknames[2], 'voter');
    for (const page of pages) {
      await expect(page.getByTestId('member-count')).toHaveText('3 members');
    }

    await voteCard(voterOnePage, '3').click();
    await voteCard(voterTwoPage, '8').click();
    for (const page of pages) {
      await expect(memberCard(page, nicknames[0])).toHaveAttribute('data-vote-status', 'pending');
      await expect(memberCard(page, nicknames[1])).toHaveAttribute('data-vote-status', 'voted');
      await expect(memberCard(page, nicknames[2])).toHaveAttribute('data-vote-status', 'voted');
      await expect(page.getByTestId('member-grid').getByTestId('member-card-front')).toHaveCount(0);
    }

    await hostPage.getByTestId('reveal-button').click();
    for (const page of pages) {
      await expect(page.getByTestId('round-status')).toHaveText(/revealed/i);
      await expectRevealedVotes(page, [
        { nickname: 'Tie Voter One', value: '3' },
        { nickname: 'Tie Voter Two', value: '8' },
      ]);
      await expectDistribution(page, ['3', '8'], ['1', '1']);
    }
    await expect(hostPage.getByText('Tied estimates: 3, 8')).toBeVisible();
    await expect(hostPage.getByLabel(/final estimate/i)).toHaveValue('');
    const nextRoundButton = hostPage.getByRole('button', { name: 'Next round' });
    await expect(nextRoundButton).toBeDisabled();

    await hostPage.getByLabel(/final estimate/i).fill('8');
    await expect(nextRoundButton).toBeEnabled();
  } finally {
    await Promise.all([hostContext?.close(), voterOneContext?.close(), voterTwoContext?.close()]);
  }
});

test('an observer sees the room but has no vote controls', async ({ browser }) => {
  let hostContext: BrowserContext | undefined;
  let observerContext: BrowserContext | undefined;
  try {
    hostContext = await browser.newContext();
    observerContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const observerPage = await observerContext.newPage();
    await createRoom(hostPage, 'Observer fixture', 'Host');
    const code = await hostPage.getByTestId('room-code').textContent();
    if (!code) {
      throw new Error('Room creation did not render a room code.');
    }
    await joinExistingRoom(observerPage, code, 'Observer', 'observer');
    await expect(observerPage.getByRole('region', { name: 'Members' })).toBeVisible();
    await expect(observerPage.getByRole('group', { name: /fibonacci cards/i })).toHaveCount(0);
  } finally {
    await Promise.all([hostContext?.close(), observerContext?.close()]);
  }
});

test('a room at capacity rejects the next join', async ({ browser }) => {
  const { url, anonKey } = {
    url: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY,
  };
  if (!url || !anonKey) {
    throw new Error('Capacity E2E fixture requires SUPABASE_URL and SUPABASE_ANON_KEY.');
  }
  const fixture = await createOnlineRoomFixture({ url, anonKey, voterCount: 90, observerCount: 9 });
  let context: BrowserContext | undefined;
  try {
    context = await browser.newContext();
    const page = await context.newPage();
    await joinExistingRoom(page, fixture.room.code, 'One Hundred One', 'voter');
    await expect(page.getByTestId('join-error')).toHaveText(/room is full/i);
  } finally {
    try {
      await context?.close();
    } finally {
      await fixture.dispose();
    }
  }
});
