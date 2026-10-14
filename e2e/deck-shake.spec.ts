import { expect, test, type Page } from '@playwright/test';
import { createRoom, joinExistingRoom, roomCode } from './helpers';

type ShakeWindow = Window & { voteShakes: Record<string, number> };

function memberCard(page: Page, nickname: string) {
  return page.getByTestId('member-grid').locator('li').filter({ hasText: nickname });
}

test('responsive poker choices stay centered without displaying the selected vote', async ({ page }) => {
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
    expect(layout.widths.every((value) => value >= 44 && value <= 64)).toBe(true);
    expect(layout.heights.every((value) => value >= 66 && value <= 96)).toBe(true);
    expect(layout.heights.every((value, index) => value / layout.widths[index] >= 1.45)).toBe(true);
    expect(layout.centerOffsets.every((value) => value < 6)).toBe(true);
    expect(layout.overflowing).toBe(false);
  }
  const vote = page.getByRole('button', { name: /^5( selected)?$/ });
  await expect(vote).toBeEnabled();
  const restingAppearance = await vote.evaluate((element) => {
    const style = getComputedStyle(element);
    const face = getComputedStyle(element.querySelector('.card-front')!);
    return { transform: style.transform, shadow: style.boxShadow, background: face.background };
  });
  await vote.click();
  await expect(memberCard(page, 'Deck Host')).toHaveAttribute('data-vote-status', 'voted');
  await page.mouse.move(0, 0);
  await expect(vote).toHaveAttribute('aria-pressed', 'true');
  await expect(vote).toHaveCSS('outline-style', 'none');
  await expect.poll(() => vote.evaluate((element) => {
    const style = getComputedStyle(element);
    const face = getComputedStyle(element.querySelector('.card-front')!);
    return { transform: style.transform, shadow: style.boxShadow, background: face.background };
  })).toEqual(restingAppearance);
});

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`votes and revotes do not flash the deck or round controls during submission (${reducedMotion})`, async ({ page, browser }) => {
    await page.emulateMedia({ reducedMotion });
    const voterContext = await browser.newContext();
    let release: (() => void) | undefined;
    const controls = page.locator('.card-button, .round-controls button');
    const appearance = () => controls.evaluateAll((elements) => elements.map((element) => {
      const style = getComputedStyle(element);
      return {
        opacity: style.opacity,
        transform: style.transform,
        shadow: style.boxShadow,
        background: style.background,
      };
    }));
    const finishTransitions = () => controls.evaluateAll(async (elements) => {
      await Promise.all(elements.flatMap((element) => element.getAnimations().map((animation) => animation.finished)));
    });
    try {
      await createRoom(page, 'Stable vote fixture', 'Stable Host');
      await joinExistingRoom(await voterContext.newPage(), roomCode(page), 'Stable Voter', 'voter');
      await expect(page.getByTestId('member-count')).toHaveText('2 members');
      await expect(page.getByTestId('connection-status')).toHaveText('Connected');
      const originalControls = await controls.elementHandles();
      for (const { value, rejected } of [
        { value: '5', rejected: false },
        { value: '8', rejected: false },
        { value: '13', rejected: true },
      ] as const) {
        const choice = page.getByRole('button', { name: new RegExp(`^${value}( selected)?( disabled)?$`) });
        await expect(choice).toBeEnabled();
        await choice.hover();
        await finishTransitions();
        const resting = await appearance();
        let requests = 0;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        await page.route('**/rest/v1/rpc/submit_vote', async (route) => {
          requests += 1;
          await gate;
          if (rejected) {
            await route.fulfill({
              status: 400,
              contentType: 'application/json',
              body: JSON.stringify({ message: 'Vote rejected for stable-display regression' }),
            });
          } else {
            await route.continue();
          }
        });
        await choice.click();
        await expect.poll(() => requests).toBe(1);
        for (const control of await controls.all()) await expect(control).toBeDisabled();
        await finishTransitions();
        expect(await page.evaluate((elements) => elements.every((element) => element.isConnected), originalControls)).toBe(true);
        expect(await appearance()).toEqual(resting);
        await expect(page.getByRole('main')).toHaveAttribute('aria-busy', 'true');
        await choice.dispatchEvent('click');
        expect(requests).toBe(1);
        release!();
        await expect(choice).toBeEnabled();
        await expect(page.getByRole('main')).toHaveAttribute('aria-busy', 'false');
        if (rejected) {
          await expect(page.getByRole('status').filter({ hasText: 'Room alert' })).toContainText('Vote rejected for stable-display regression');
          await expect(page.getByRole('button', { name: '8 selected', exact: true })).toHaveAttribute('aria-pressed', 'true');
        } else {
          await expect(choice).toHaveAttribute('aria-pressed', 'true');
          await expect(memberCard(page, 'Stable Host')).toHaveAttribute('data-vote-status', 'voted');
        }
        await page.unrouteAll({ behavior: 'wait' });
      }
    } finally {
      release?.();
      await page.unrouteAll({ behavior: 'wait' });
      await voterContext.close();
    }
  });
}

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
