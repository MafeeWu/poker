import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createRoom, joinExistingRoom, roomCode } from './helpers';
import { createOnlineRoomFixture } from '../scripts/room-fixtures.mjs';

function memberCard(page: Page, nickname: string) {
  return page.getByTestId('member-grid').locator('li').filter({ hasText: nickname });
}

function voteCard(page: Page, value: string) {
  return page.getByRole('button', { name: value, exact: true });
}

type RapidJoinRpcObservation = {
  rpc: string;
  status: number;
  memberCount?: number;
  roundStatus?: string;
  errorCode?: string;
  errorMessage?: string;
};

type RapidJoinTrace = {
  nickname: string;
  memberCounts: string[];
  connectionStates: string[];
  rpcResponses: RapidJoinRpcObservation[];
};

function recordRapidJoinDiagnostics(page: Page, nickname: string, roomCode: string) {
  const trace: RapidJoinTrace = {
    nickname,
    memberCounts: [],
    connectionStates: [],
    rpcResponses: [],
  };
  const responseTasks: Promise<void>[] = [];
  let samplingTask: Promise<void> | undefined;
  let stopped = false;

  const samplePageState = (): Promise<void> => {
    if (page.isClosed()) {
      return Promise.resolve();
    }
    if (samplingTask) {
      return samplingTask;
    }
    samplingTask = page.evaluate(() => ({
      memberCount: document.querySelector('[data-testid="member-count"]')?.textContent?.trim() ?? '',
      connectionState: document.querySelector('[data-testid="connection-status"]')?.textContent?.trim() ?? '',
    }))
      .then((state) => {
        if (state.memberCount && !trace.memberCounts.includes(state.memberCount)) {
          trace.memberCounts.push(state.memberCount);
        }
        if (state.connectionState && !trace.connectionStates.includes(state.connectionState)) {
          trace.connectionStates.push(state.connectionState);
        }
      })
      .catch(() => {
        // Navigation can temporarily leave the page without a document to sample.
      })
      .finally(() => {
        samplingTask = undefined;
      });
    return samplingTask;
  };

  const onResponse = (response: import('@playwright/test').Response) => {
    const rpc = new URL(response.url()).pathname.match(/\/rpc\/(join_room|build_room_snapshot)$/)?.[1];
    if (!rpc) {
      return;
    }

    const task = response.json().then((payload: unknown) => {
      const data = (Array.isArray(payload) ? payload[0] : payload) as Record<string, unknown> | null;
      const observation: RapidJoinRpcObservation = { rpc, status: response.status() };
      if (data && Array.isArray(data.members)) {
        observation.memberCount = data.members.length;
      }
      if (data?.round && typeof data.round === 'object' && 'status' in data.round && typeof data.round.status === 'string') {
        observation.roundStatus = data.round.status;
      }
      if (!response.ok() && data) {
        if (typeof data.code === 'string') {
          observation.errorCode = data.code;
        }
        if (typeof data.message === 'string') {
          observation.errorMessage = data.message
            .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted]')
            .replace(/\b(?:sb_(?:publishable|secret)_[A-Za-z0-9_-]+)\b/g, '[redacted]')
            .replace(/\b(?:apikey|authorization)\s*[:=]\s*\S+/gi, '[redacted]')
            .replaceAll(roomCode, '[redacted]')
            .slice(0, 180);
        }
      }
      trace.rpcResponses.push(observation);
    }).catch(() => {
      trace.rpcResponses.push({ rpc, status: response.status() });
    });
    responseTasks.push(task);
  };

  page.on('response', onResponse);
  const sampler = setInterval(() => {
    void samplePageState();
  }, 50);

  return {
    trace,
    async stop() {
      if (stopped) {
        return;
      }
      stopped = true;
      clearInterval(sampler);
      page.off('response', onResponse);
      await samplePageState();
      await Promise.all(responseTasks);
    },
  };
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
    const front = memberCard(page, nickname).getByTestId('member-card-front');
    await expect(front).toHaveText(value);
    const motion = await front.evaluate((element) => {
      const style = getComputedStyle(element.parentElement!);
      return { property: style.transitionProperty, duration: parseFloat(style.transitionDuration) };
    });
    expect(motion.property).toContain('transform');
    expect(motion.duration).toBeGreaterThan(0);
    await expect.poll(() => front.evaluate((element) => {
      const transform = getComputedStyle(element.parentElement!).transform;
      return Math.round(new DOMMatrixReadOnly(transform).m11);
    })).toBe(-1);
  }
}

async function expectDistribution(page: Page, labels: string[], counts: string[]) {
  const chart = page.getByTestId('distribution-bars');
  await expect(chart.locator('.distribution-label')).toHaveText(labels);
  await expect(chart.locator('.distribution-count')).toHaveText(counts);
  await expect.poll(
    () => chart.evaluate((distribution) => {
      const memberGrid = document.querySelector('[data-testid="member-grid"]');
      if (!memberGrid) {
        return false;
      }

      const followsMemberGrid = Boolean(
        memberGrid.compareDocumentPosition(distribution) & Node.DOCUMENT_POSITION_FOLLOWING,
      );
      const memberGridBottom = memberGrid.getBoundingClientRect().bottom;
      const distributionTop = distribution.getBoundingClientRect().top;
      return followsMemberGrid && distributionTop >= memberGridBottom;
    }),
    { message: 'After Reveal, the distribution must appear after and visually below the complete member grid.' },
  ).toBe(true);
}

test('three independent members complete two rounds without exposing votes before Reveal', async ({ browser }) => {
  let hostContext: BrowserContext | undefined;
  let voterOneContext: BrowserContext | undefined;
  let voterTwoContext: BrowserContext | undefined;
  const diagnostics: ReturnType<typeof recordRapidJoinDiagnostics>[] = [];
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
    const code = roomCode(hostPage);
    diagnostics.push(...pages.map((page, index) => recordRapidJoinDiagnostics(page, nicknames[index], code)));
    await joinExistingRoom(voterOnePage, code, nicknames[1], 'voter');
    await expect(voterOnePage.getByTestId('join-error')).toHaveCount(0);
    await expect(hostPage.getByTestId('member-count')).toHaveText('2 members');
    await expect(voterOnePage.getByTestId('member-count')).toHaveText('2 members');
    await joinExistingRoom(voterTwoPage, code, nicknames[2], 'voter');
    await expect(voterTwoPage.getByTestId('join-error')).toHaveCount(0);
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
      await expect(page.getByLabel('Note')).toHaveValue('Ship the smaller slice');
    }

    await voterOnePage.getByRole('button', { name: 'Next round' }).click();
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

    await voterTwoPage.getByTestId('reveal-button').click();
    for (const page of pages) {
      await expect(page.getByTestId('round-status')).toHaveText(/revealed/i);
      await expectRevealedVotes(page, secondRoundVotes);
      await expectDistribution(page, ['5', '8', '13'], ['1', '1', '1']);
    }
    await expect(hostPage.getByLabel(/final estimate/i)).toHaveValue('');
    await expect(hostPage.getByText('Tied estimates: 5, 8, 13')).toBeVisible();
  } catch (error) {
    await Promise.all(diagnostics.map((item) => item.stop()));
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}\nRoom diagnostics (sanitized): ${JSON.stringify(diagnostics.map((item) => item.trace))}`);
  } finally {
    await Promise.all(diagnostics.map((item) => item.stop()));
    await Promise.all([hostContext?.close(), voterOneContext?.close(), voterTwoContext?.close()]);
  }
});

test('observers stay read-only while a voter reveals, edits and advances the round', async ({ browser }) => {
  const hostContext = await browser.newContext();
  const voterContext = await browser.newContext();
  const observerContext = await browser.newContext();
  try {
    const host = await hostContext.newPage();
    const voter = await voterContext.newPage();
    const observer = await observerContext.newPage();
    await createRoom(host, 'Shared controls fixture', 'Control Host');
    const code = roomCode(host);
    await joinExistingRoom(voter, code, 'Control Voter', 'voter');
    await joinExistingRoom(observer, code, 'Control Observer', 'observer');
    for (const page of [host, voter, observer]) {
      await expect(page.getByTestId('member-count')).toHaveText('3 members');
      await expect(page.getByRole('button', { name: 'Transfer host' })).toHaveCount(0);
      await expect(page.getByRole('combobox', { name: 'Transfer host' })).toHaveCount(0);
    }
    await expect(observer.getByTestId('reveal-button')).toHaveCount(0);
    await expect(observer.getByRole('group', { name: 'Fibonacci cards' })).toHaveCount(0);
    await voter.getByRole('button', { name: '5', exact: true }).click();
    for (const page of [host, voter, observer]) {
      await expect(memberCard(page, 'Control Voter')).toHaveAttribute('data-vote-status', 'voted');
      await expect(page.getByTestId('member-card-front')).toHaveCount(0);
    }

    await voter.getByTestId('reveal-button').click();
    for (const page of [host, voter, observer]) {
      await expect(page.getByTestId('round-status')).toHaveText('Revealed');
      await expect(memberCard(page, 'Control Voter').getByTestId('member-card-front')).toHaveText('5');
    }
    await expect(observer.getByRole('region', { name: 'Round controls' })).toHaveCount(0);
    await expect(observer.getByRole('textbox', { name: 'Note' })).toHaveCount(0);
    await expect(observer.getByRole('button', { name: 'Next round' })).toHaveCount(0);

    await voter.getByLabel('Final estimate').fill('13');
    await voter.getByLabel('Note').click();
    await expect(voter.getByLabel('Note')).toBeEnabled();
    await voter.getByLabel('Note').fill('Agreed by the team');
    await voter.getByRole('heading', { name: 'Round outcome' }).click();
    await expect(host.getByLabel('Final estimate')).toHaveValue('13');
    await expect(host.getByLabel('Note')).toHaveValue('Agreed by the team');
    await expect(observer.getByTestId('current-round-note')).toHaveText('Note: Agreed by the team');
    await voter.getByRole('button', { name: 'Next round' }).click();
    for (const page of [host, voter, observer]) {
      await expect(page.getByTestId('round-board').getByRole('heading')).toHaveText('Round 2');
      await expect(page.getByRole('region', { name: 'Round history' })).toContainText('Final estimate: 13');
      await expect(page.getByRole('region', { name: 'Round history' })).toContainText('Agreed by the team');
    }
  } finally {
    await Promise.all([hostContext.close(), voterContext.close(), observerContext.close()]);
  }
});

test('rapid independent joins converge on every room session', async ({ browser }) => {
  let hostContext: BrowserContext | undefined;
  let voterOneContext: BrowserContext | undefined;
  let voterTwoContext: BrowserContext | undefined;
  const diagnostics: ReturnType<typeof recordRapidJoinDiagnostics>[] = [];
  try {
    hostContext = await browser.newContext();
    voterOneContext = await browser.newContext();
    voterTwoContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const voterOnePage = await voterOneContext.newPage();
    const voterTwoPage = await voterTwoContext.newPage();
    const pages = [hostPage, voterOnePage, voterTwoPage];
    const nicknames = ['Rapid Host', 'Rapid Voter One', 'Rapid Voter Two'];

    await createRoom(hostPage, 'Rapid join fixture', nicknames[0]);
    await expect(hostPage.getByTestId('member-count')).toHaveText(/^1 members?$/);
    const code = roomCode(hostPage);

    diagnostics.push(...pages.map((page, index) => recordRapidJoinDiagnostics(page, nicknames[index], code)));
    await Promise.all([voterOnePage, voterTwoPage].map(async (page, index) => {
      await page.goto('/');
      await page.getByRole('button', { name: /join project/i }).click();
      await page.getByLabel(/room code/i).fill(code);
      await page.getByLabel(/nickname/i).fill(nicknames[index + 1]);
      await page.getByRole('radio', { name: /^voter$/i }).check();
    }));

    await Promise.all([
      voterOnePage.getByRole('button', { name: /^join$/i }).click(),
      voterTwoPage.getByRole('button', { name: /^join$/i }).click(),
    ]);
    await Promise.all([voterOnePage, voterTwoPage].map((page) => (
      expect(page.getByTestId('round-status').or(page.getByTestId('join-error'))).toBeVisible()
    )));
    await Promise.all([voterOnePage, voterTwoPage].map((page) => expect(page.getByTestId('join-error')).toHaveCount(0)));
    for (const page of pages) {
      await expect(page.getByTestId('member-count')).toHaveText('3 members');
    }
  } catch (error) {
    if (diagnostics.length > 0) {
      await Promise.all(diagnostics.map((item) => item.stop()));
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message}\nRapid-join diagnostics (sanitized): ${JSON.stringify(diagnostics.map((item) => item.trace))}`);
    }
    throw error;
  } finally {
    await Promise.all(diagnostics.map((item) => item.stop()));
    await Promise.all([hostContext?.close(), voterOneContext?.close(), voterTwoContext?.close()]);
  }
});

test('a third independent session with cached room history can explicitly join a share link', async ({ browser }) => {
  const hostContext = await browser.newContext();
  const voterContext = await browser.newContext();
  let thirdContext: BrowserContext | undefined;
  try {
    const hostPage = await hostContext.newPage();
    const voterPage = await voterContext.newPage();
    await createRoom(hostPage, 'Cached identity fixture', 'Recovery Host');
    const code = roomCode(hostPage);
    await joinExistingRoom(voterPage, code, 'Recovery Second', 'voter');
    await expect(hostPage.getByTestId('member-count')).toHaveText('2 members');

    const rememberedHistory = await voterContext.storageState();
    for (const origin of rememberedHistory.origins) {
      origin.localStorage = origin.localStorage.filter((entry) => entry.name === 'poker.recentRooms');
    }
    thirdContext = await browser.newContext({ storageState: rememberedHistory });
    const thirdPage = await thirdContext.newPage();
    await thirdPage.goto(`/room/${code}`);
    await expect(thirdPage.getByRole('heading', { name: 'Join this room' })).toBeVisible();
    await expect(thirdPage.getByText(/previous room session.*join again/i)).toBeVisible();
    await expect(thirdPage.getByText('Loading room…', { exact: true })).toHaveCount(0);
    await expect(thirdPage.getByLabel('Nickname')).toHaveValue('');
    await thirdPage.getByLabel('Nickname').fill('Recovery Third');
    await thirdPage.getByRole('button', { name: 'Join', exact: true }).click();

    for (const page of [hostPage, voterPage, thirdPage]) {
      await expect(page.getByTestId('member-count')).toHaveText('3 members');
      await expect(memberCard(page, 'Recovery Third')).toBeVisible();
    }
    await voteCard(thirdPage, '8').click();
    for (const page of [hostPage, voterPage, thirdPage]) {
      await expect(memberCard(page, 'Recovery Third')).toHaveAttribute('data-vote-status', 'voted');
      await expect(memberCard(page, 'Recovery Second')).toHaveAttribute('data-vote-status', 'pending');
    }
  } finally {
    await Promise.all([hostContext.close(), voterContext.close(), thirdContext?.close()]);
  }
});

test('clearing browser identity offers explicit rejoining instead of a stuck loading screen', async ({ browser }) => {
  const hostContext = await browser.newContext();
  const voterContext = await browser.newContext();
  try {
    const hostPage = await hostContext.newPage();
    const voterPage = await voterContext.newPage();
    await createRoom(hostPage, 'Reload recovery fixture', 'Reload Host');
    const code = roomCode(hostPage);
    await joinExistingRoom(voterPage, code, 'Reload Voter', 'voter');
    await voterPage.evaluate(() => {
      for (const key of Object.keys(localStorage)) {
        if (key !== 'poker.recentRooms') localStorage.removeItem(key);
      }
    });
    await voterPage.reload();

    await expect(voterPage.getByRole('heading', { name: 'Join this room' })).toBeVisible();
    await expect(voterPage.getByText(/previous room session.*join again/i)).toBeVisible();
    await expect(voterPage.getByText('Connection error', { exact: true })).toHaveCount(0);
    await expect(voterPage.getByText('Loading room…', { exact: true })).toHaveCount(0);
    await expect(voterPage.getByLabel('Room code')).toHaveValue(code);
    await expect(voterPage.getByLabel('Nickname')).toHaveValue('');
  } finally {
    await Promise.all([hostContext.close(), voterContext.close()]);
  }
});

test('duplicate nicknames show an actionable error and allow retrying without losing the form', async ({ browser }) => {
  const hostContext = await browser.newContext();
  const voterContext = await browser.newContext();
  const observerContext = await browser.newContext();
  try {
    const hostPage = await hostContext.newPage();
    const voterPage = await voterContext.newPage();
    const observerPage = await observerContext.newPage();
    await createRoom(hostPage, 'Unique nickname fixture', 'Mina');
    const code = roomCode(hostPage);

    await joinExistingRoom(voterPage, code, ' mina ', 'voter');
    await expect(voterPage.getByRole('alert')).toHaveText(/nickname.*already.*use.*choose another/i);
    await expect(voterPage.getByLabel('Nickname')).toHaveValue(' mina ');
    await expect(voterPage.getByLabel('Room code')).toHaveValue(code);
    await expect(voterPage.getByRole('radio', { name: 'Voter', exact: true })).toBeChecked();
    await expect(hostPage.getByTestId('member-count')).toHaveText(/^1 members?$/);
    await voterPage.getByLabel('Nickname').fill('Bob');
    await voterPage.getByRole('button', { name: 'Join', exact: true }).click();
    await expect(voterPage.getByTestId('member-count')).toHaveText('2 members');
    await expect(voterPage.getByRole('alert')).toHaveCount(0);

    await observerPage.goto(`/room/${code}`);
    await observerPage.getByLabel('Nickname').fill('BOB');
    await observerPage.getByRole('radio', { name: 'Observer', exact: true }).check();
    await observerPage.getByRole('button', { name: 'Join', exact: true }).click();
    await expect(observerPage.getByRole('alert')).toHaveText(/nickname.*already.*use/i);
    await expect(observerPage.getByLabel('Nickname')).toHaveValue('BOB');
    await expect(observerPage.getByRole('radio', { name: 'Observer', exact: true })).toBeChecked();
    await observerPage.getByLabel('Nickname').fill('Carol');
    await observerPage.getByRole('button', { name: 'Join', exact: true }).click();
    for (const page of [hostPage, voterPage, observerPage]) {
      await expect(page.getByTestId('member-count')).toHaveText('3 members');
      await expect(memberCard(page, 'Mina')).toBeVisible();
      await expect(memberCard(page, 'Bob')).toBeVisible();
      await expect(memberCard(page, 'Carol')).toBeVisible();
    }
    await expect(observerPage.getByRole('group', { name: /fibonacci cards/i })).toHaveCount(0);
  } finally {
    await Promise.all([hostContext.close(), voterContext.close(), observerContext.close()]);
  }
});

test('concurrent joins with the same normalized nickname admit only one member', async ({ browser }) => {
  const hostContext = await browser.newContext();
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  try {
    const hostPage = await hostContext.newPage();
    const firstPage = await firstContext.newPage();
    const secondPage = await secondContext.newPage();
    await createRoom(hostPage, 'Nickname race fixture', 'Race Host');
    const code = roomCode(hostPage);
    await Promise.all([firstPage, secondPage].map(async (page, index) => {
      await page.goto(`/room/${code}`);
      await page.getByLabel('Nickname').fill(index === 0 ? 'Shared name' : ' SHARED NAME ');
    }));
    await Promise.all([firstPage, secondPage].map((page) => (
      page.getByRole('button', { name: 'Join', exact: true }).click()
    )));
    await Promise.all([firstPage, secondPage].map((page) => (
      expect(page.getByTestId('round-status').or(page.getByTestId('join-error'))).toBeVisible()
    )));
    const firstRejected = await firstPage.getByTestId('join-error').count() > 0;
    const rejected = firstRejected ? firstPage : secondPage;
    const admitted = firstRejected ? secondPage : firstPage;
    await expect(rejected.getByTestId('join-error')).toHaveText(/nickname.*already.*use/i);
    await expect(admitted.getByTestId('join-error')).toHaveCount(0);
    for (const page of [hostPage, admitted]) {
      await expect(page.getByTestId('member-count')).toHaveText('2 members');
      await expect(page.getByTestId('member-grid').locator('li')).toHaveCount(2);
    }
    await rejected.getByLabel('Nickname').fill('Different name');
    await rejected.getByRole('button', { name: 'Join', exact: true }).click();
    for (const page of [hostPage, firstPage, secondPage]) {
      await expect(page.getByTestId('member-count')).toHaveText('3 members');
    }
  } finally {
    await Promise.all([hostContext.close(), firstContext.close(), secondContext.close()]);
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
    const code = roomCode(hostPage);
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
    const code = roomCode(hostPage);
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
