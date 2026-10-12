import { expect, test, type Page } from '@playwright/test';
import { createRoom, joinExistingRoom, roomCode } from './helpers';

type ShakeWindow = Window & { voteShakes: Record<string, number> };

function memberCard(page: Page, nickname: string) {
  return page.getByTestId('member-grid').locator('li').filter({ hasText: nickname });
}

test('wider rooms center enlarged choices without retaining visual vote selection', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await createRoom(page, 'Deck layout fixture', 'Deck Host');
  await expect(page.getByRole('main')).toHaveCSS('width', '1400px');
  const deck = page.getByRole('group', { name: 'Fibonacci cards' });
  for (const width of [1600, 1024, 769, 375, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const layout = await deck.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const buttons = [...element.querySelectorAll('button')];
      const rows = new Map<number, HTMLElement[]>();
      for (const button of buttons) {
        const row = rows.get(button.offsetTop) ?? [];
        row.push(button);
        rows.set(button.offsetTop, row);
      }
      return {
        widths: buttons.map((button) => parseFloat(getComputedStyle(button).width)),
        heights: buttons.map((button) => parseFloat(getComputedStyle(button).height)),
        centerOffsets: [...rows.values()].map((row) => {
          const first = row[0].getBoundingClientRect();
          const last = row.at(-1)!.getBoundingClientRect();
          return Math.abs((first.left + last.right) / 2 - (bounds.left + bounds.right) / 2);
        }),
        overflowing: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });
    expect(layout.widths.every((value) => value === 64)).toBe(true);
    expect(layout.heights.every((value) => value === 96)).toBe(true);
    expect(layout.centerOffsets.every((value) => value < 6)).toBe(true);
    expect(layout.overflowing).toBe(false);
  }
  await page.getByRole('button', { name: '5', exact: true }).click();
  await expect(memberCard(page, 'Deck Host')).toHaveAttribute('data-vote-status', 'voted');
  await page.mouse.move(0, 0);
  await expect(deck.locator('.selected')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '5 selected', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('every client shakes the corresponding member after votes and revotes without revealing the value', async ({ browser }) => {
  const hostContext = await browser.newContext();
  const voterContext = await browser.newContext();
  const observerContext = await browser.newContext();
  try {
    for (const context of [hostContext, voterContext, observerContext]) {
      await context.addInitScript(() => {
        (window as ShakeWindow).voteShakes = {};
        document.addEventListener('animationstart', (event) => {
          if (event.animationName !== 'member-vote-shake' || !(event.target instanceof Element)) return;
          const memberId = event.target.closest('li')?.getAttribute('data-testid');
          if (memberId) {
            const counts = (window as ShakeWindow).voteShakes;
            counts[memberId] = (counts[memberId] ?? 0) + 1;
          }
        });
      });
    }
    const host = await hostContext.newPage();
    const voter = await voterContext.newPage();
    const observer = await observerContext.newPage();
    await createRoom(host, 'Shake fixture', 'Shake Host');
    const code = roomCode(host);
    await joinExistingRoom(voter, code, 'Shake Voter', 'voter');
    await joinExistingRoom(observer, code, 'Shake Guest', 'observer');
    for (const page of [host, voter, observer]) {
      await expect(page.getByTestId('member-count')).toHaveText('3 members');
      await expect(page.getByTestId('connection-status')).toHaveText('Connected');
    }
    const voterId = await memberCard(voter, 'Shake Voter').getAttribute('data-testid');
    for (const [index, value] of ['5', '8', '8'].entries()) {
      if (index === 2) await observer.emulateMedia({ reducedMotion: 'reduce' });
      await voter.getByRole('button', { name: new RegExp(`^${value}( selected)?$`) }).click();
      for (const page of index < 2 ? [host, voter, observer] : [host, voter]) {
        await expect.poll(() => page.evaluate((id) => (window as ShakeWindow).voteShakes[id!], voterId)).toBe(index + 1);
        await expect(memberCard(page, 'Shake Voter').getByTestId('member-card-front')).toHaveCount(0);
        await expect(memberCard(page, 'Shake Voter')).not.toHaveAccessibleName(/\bvote (5|8)\b/);
      }
      if (index === 2) {
        await expect(memberCard(observer, 'Shake Voter').locator('.member-vote-flip')).toHaveCSS('animation-name', 'none');
        expect(await observer.evaluate((id) => (window as ShakeWindow).voteShakes[id!], voterId)).toBe(2);
      }
    }
    await voter.route('**/rest/v1/rpc/submit_vote', (route) => route.fulfill({
      status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'Vote rejected for regression' }),
    }));
    await voter.getByRole('button', { name: '13', exact: true }).click();
    await expect(voter.getByRole('status').filter({ hasText: 'Room alert' })).toContainText('Vote rejected for regression');
    for (const page of [host, voter]) {
      expect(await page.evaluate((id) => (window as ShakeWindow).voteShakes[id!], voterId)).toBe(3);
    }
    await voter.unrouteAll({ behavior: 'wait' });
    await voter.reload();
    await expect(memberCard(voter, 'Shake Voter')).toHaveAttribute('data-vote-status', 'voted');
    expect(await voter.evaluate(() => Object.keys((window as ShakeWindow).voteShakes))).toEqual([]);
    await host.getByTestId('reveal-button').click();
    for (const page of [host, voter, observer]) {
      await expect(memberCard(page, 'Shake Voter').getByTestId('member-card-front')).toHaveText('8');
    }
  } finally {
    await Promise.all([hostContext.close(), voterContext.close(), observerContext.close()]);
  }
});
