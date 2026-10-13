import { expect, test, type Locator } from '@playwright/test';
import { createRoom, joinExistingRoom, roomCode } from './helpers';

function contrastRatio({ text, background }: { text: string; background: string }): number {
  const luminance = (color: string) => {
    const channels = color.match(/[\d.]+/g);
    if (!channels || channels.length < 3) throw new Error(`Unsupported computed color: ${color}`);
    const [red, green, blue] = channels.slice(0, 3).map((channel) => {
      const value = Number(channel) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const foreground = luminance(text);
  const surface = luminance(background);
  return (Math.max(foreground, surface) + 0.05) / (Math.min(foreground, surface) + 0.05);
}

async function cardAppearance(card: Locator) {
  return card.evaluate((element) => {
    const style = getComputedStyle(element);
    const face = getComputedStyle(element.querySelector('.card-front')!);
    return {
      outline: style.outline,
      transform: style.transform,
      shadow: style.boxShadow,
      opacity: style.opacity,
      background: face.backgroundColor,
      texture: face.backgroundImage,
      color: face.color,
    };
  });
}

test('entry modes and role choices remain clear and fit narrow screens', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Create project' })).toHaveAttribute('aria-pressed', 'true');
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeInViewport({ ratio: 1 });
  for (const width of [1440, 768, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )).toBeLessThanOrEqual(0);
  }
  await page.screenshot({ path: testInfo.outputPath('home-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Join project' }).click();
  await expect(page.getByRole('button', { name: 'Join project' })).toHaveAttribute('aria-pressed', 'true');
  for (const radio of await page.getByRole('radio').all()) {
    const bounds = await radio.boundingBox();
    expect(bounds!.width).toBeLessThanOrEqual(24);
    expect(bounds!.height).toBeLessThanOrEqual(24);
    const targetHeight = await radio.evaluate((element) => element.closest('label')!.getBoundingClientRect().height);
    expect(targetHeight).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole('radio', { name: 'Observer' }).check();
  await expect(page.getByRole('radio', { name: 'Observer' })).toBeChecked();
  await page.screenshot({ path: testInfo.outputPath('join-mobile.png'), fullPage: true });
});

test('submitted votes leave no persistent visual selection with reduced motion', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await createRoom(page, 'Pixel table', 'Pixel Host');
  const selected = page.getByRole('button', { name: /^5( selected)?$/ });
  await expect(selected).toBeEnabled();
  const unselectedAppearance = await cardAppearance(selected);
  await selected.click();
  await expect(selected).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('heading', { level: 1 }).click();
  await expect.poll(() => cardAppearance(selected)).toEqual(unselectedAppearance);
  const wildcard = page.getByRole('button', { name: /^question mark( selected)?$/ });
  const wildcardAppearance = await cardAppearance(wildcard);
  await wildcard.click();
  await expect(wildcard).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('heading', { level: 1 }).click();
  await expect.poll(() => cardAppearance(wildcard)).toEqual(wildcardAppearance);
  await selected.click();
  await expect(selected).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('heading', { level: 1 }).click();
  await expect.poll(() => cardAppearance(selected)).toEqual(unselectedAppearance);
  await selected.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(selected).toBeFocused();
  await expect(selected).toHaveCSS('outline-style', 'solid');
  await expect(selected).toHaveCSS('outline-width', '3px');
  await page.getByRole('heading', { level: 1 }).click();
  for (const width of [1440, 1280, 769, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )).toBeLessThanOrEqual(0);
    if (width >= 1280) {
      const cardTops = await page.getByTestId('card-button').evaluateAll((cards) =>
        cards.map((card) => card.getBoundingClientRect().top),
      );
      expect(Math.max(...cardTops) - Math.min(...cardTops)).toBeLessThanOrEqual(1);
    }
  }
  await page.screenshot({ path: testInfo.outputPath('voting-mobile.png'), fullPage: true });
  await page.getByTestId('reveal-button').click();
  await expect(page.getByTestId('member-card-front')).toHaveText('5');
  await page.getByLabel('Note').fill('A little discussion, a better estimate.');
  await page.getByRole('button', { name: 'Next round' }).click();
  await expect(page.getByRole('region', { name: 'Round history' })).toContainText('A little discussion');
  await page.screenshot({ path: testInfo.outputPath('history-mobile.png'), fullPage: true });
});

test('share-link entry uses readable themed inputs and a visible way home', async ({ browser }, testInfo) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext({ viewport: { width: 320, height: 812 } });
  try {
    const host = await hostContext.newPage();
    await createRoom(host, 'Shared pixel table', 'Host');
    const guest = await guestContext.newPage();
    await guest.goto(`/room/${roomCode(host)}`);
    await expect(guest.getByRole('heading', { name: 'Join this room' })).toBeVisible();
    const nickname = guest.getByLabel('Nickname');
    const colors = await nickname.evaluate((element) => {
      const style = getComputedStyle(element);
      return { text: style.color, background: style.backgroundColor };
    });
    expect(contrastRatio(colors)).toBeGreaterThanOrEqual(4.5);
    await expect(guest.getByRole('link', { name: /back to home/i })).toBeVisible();
    expect(await guest.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )).toBeLessThanOrEqual(0);
    await guest.screenshot({ path: testInfo.outputPath('share-entry-mobile.png'), fullPage: true });
    await guest.getByRole('link', { name: /back to home/i }).click();
    await expect(guest.getByRole('heading', { name: 'Poker', exact: true })).toBeVisible();
  } finally {
    await Promise.all([hostContext.close(), guestContext.close()]);
  }
});

test('tied-estimate options stay readable when hovered and selected', async ({ browser }) => {
  const hostContext = await browser.newContext();
  const voterContext = await browser.newContext();
  try {
    const host = await hostContext.newPage();
    const voter = await voterContext.newPage();
    await createRoom(host, 'Readable tied choices', 'Host');
    await joinExistingRoom(voter, roomCode(host), 'Voter', 'voter');
    await host.getByRole('button', { name: '5', exact: true }).click();
    await voter.getByRole('button', { name: '8', exact: true }).click();
    await expect(host.getByTestId('member-grid').locator('[data-card-state="voted"]')).toHaveCount(2);
    await host.getByTestId('reveal-button').click();
    const option = host.getByRole('button', { name: 'Use estimate 5', exact: true });
    await expect(option).toHaveAttribute('aria-pressed', 'false');
    await option.hover();
    await option.evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished));
    });
    await expect.poll(async () => contrastRatio(await option.evaluate((element) => {
      const style = getComputedStyle(element);
      return { text: style.color, background: style.backgroundColor };
    }))).toBeGreaterThanOrEqual(4.5);
    await option.click();
    await expect(option).toHaveAttribute('aria-pressed', 'true');
    await expect(host.getByLabel('Final estimate')).toHaveValue('5');
    await expect.poll(async () => contrastRatio(await option.evaluate((element) => {
      const style = getComputedStyle(element);
      return { text: style.color, background: style.backgroundColor };
    }))).toBeGreaterThanOrEqual(4.5);
  } finally {
    await Promise.all([hostContext.close(), voterContext.close()]);
  }
});
