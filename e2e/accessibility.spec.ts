import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { createRoom, joinExistingRoom } from './helpers';

async function tabTo(page: Page, target: Locator, maxTabs = 40): Promise<void> {
  for (let index = 0; index < maxTabs; index += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((element) => element === document.activeElement)) {
      return;
    }
  }
  throw new Error(`Keyboard navigation did not reach ${await target.getAttribute('aria-label') ?? 'the requested control'}.`);
}

async function expectVisibleFocus(target: Locator): Promise<void> {
  await expect(target).toBeFocused();
  await expect(target).toHaveCSS('outline-style', 'solid');
  await expect(target).toHaveCSS('outline-width', '3px');
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect.poll(() =>
    page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
  ).toBeLessThanOrEqual(0);
}

function memberCard(page: Page, nickname: string) {
  return page.getByTestId('member-grid').locator('li').filter({ hasText: nickname });
}

test('reduced motion preserves member reveals, chart labels, and estimate with keyboard access on mobile', async ({ browser }) => {
  let hostContext: BrowserContext | undefined;
  let voterContext: BrowserContext | undefined;
  try {
    const mobileReducedMotion = {
      reducedMotion: 'reduce' as const,
      viewport: { width: 375, height: 812 },
    };
    hostContext = await browser.newContext(mobileReducedMotion);
    voterContext = await browser.newContext(mobileReducedMotion);
    const hostPage = await hostContext.newPage();
    const voterPage = await voterContext.newPage();
    await createRoom(hostPage, 'Reduced motion fixture', 'Motion Host');
    const code = await hostPage.getByTestId('room-code').textContent();
    if (!code) {
      throw new Error('Room creation did not render a room code.');
    }
    await joinExistingRoom(voterPage, code, 'Motion Voter', 'voter');
    await expect(hostPage.getByTestId('member-count')).toHaveText('2 members');
    await expect(voterPage.getByTestId('member-count')).toHaveText('2 members');

    await hostPage.getByRole('button', { name: /^5/ }).click();
    await voterPage.getByRole('button', { name: /^5/ }).click();
    const revealButton = hostPage.getByTestId('reveal-button');
    await tabTo(hostPage, revealButton);
    await expectVisibleFocus(revealButton);
    await revealButton.press('Enter');

    for (const page of [hostPage, voterPage]) {
      await expect(page.getByTestId('round-status')).toHaveText(/revealed/i);
      await expect(memberCard(page, 'Motion Host').getByTestId('member-card-front')).toHaveText('5');
      await expect(memberCard(page, 'Motion Voter').getByTestId('member-card-front')).toHaveText('5');
      const chart = page.getByTestId('distribution-bars');
      await expect(chart.getByRole('img', { name: '5 votes: 2' })).toBeVisible();
      await expect(chart.locator('.distribution-label')).toHaveText(['5']);
      await expect(chart.locator('.distribution-count')).toHaveText(['2']);
      await expect.poll(() =>
        page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches),
      ).toBe(true);
      await expect.poll(() =>
        memberCard(page, 'Motion Host').getByTestId('member-card-front').evaluate(
          (element) => getComputedStyle(element).animationName,
        ),
      ).toBe('none');
      const flip = await memberCard(page, 'Motion Host').getByTestId('member-card-front').evaluate((element) => {
        const style = getComputedStyle(element.parentElement!);
        return { duration: parseFloat(style.transitionDuration), rotation: new DOMMatrixReadOnly(style.transform).m11 };
      });
      expect(flip.duration).toBe(0);
      expect(flip.rotation).toBe(-1);
      await expect.poll(() =>
        chart.locator('.distribution-bar').evaluate((element) => getComputedStyle(element).animationName),
      ).toBe('none');
      await expectNoHorizontalOverflow(page);
    }

    const estimate = hostPage.getByLabel(/final estimate/i);
    await expect(estimate).toHaveValue('5');
    await estimate.press('Tab');
    for (const page of [hostPage, voterPage]) {
      await expect(page.getByTestId('final-estimate-value')).toHaveText('Final estimate: 5');
    }
    const nextRoundButton = hostPage.getByRole('button', { name: 'Next round' });
    await tabTo(hostPage, nextRoundButton);
    await expectVisibleFocus(nextRoundButton);
    await nextRoundButton.press('Enter');
    for (const page of [hostPage, voterPage]) {
      await expect(page.getByTestId('round-board').getByRole('heading')).toHaveText('Round 2');
      await expectNoHorizontalOverflow(page);
    }
  } finally {
    await Promise.all([hostContext?.close(), voterContext?.close()]);
  }
});
