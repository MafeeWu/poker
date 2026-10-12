import { expect, test } from '@playwright/test';
import { createRoom } from './helpers';

test('creates a room and copies its share link', async ({ page }) => {
  await createRoom(page, 'Sprint 24', 'Host');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sprint 24');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: /copy share link/i }).click();
  await expect(page.locator('.room-header').getByRole('status')).toHaveText(/copied/i);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());
});

test('room name, compact header tools and round heading fit desktop and narrow screens', async ({ page }, testInfo) => {
  const name = 'PlanningPokerHeader'.repeat(4);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await createRoom(page, name, 'Header Host');
  const header = page.locator('.room-header');
  const heading = header.getByRole('heading', { level: 1 });
  await expect(heading).toHaveText(name);
  await expect(header.getByText(name, { exact: true })).toHaveCount(1);
  await expect(header.locator('p')).toHaveCount(0);
  await expect(header.getByTestId('connection-status')).toHaveText('Connected');
  const copy = header.getByRole('button', { name: 'Copy share link' });
  await expect(copy).toBeVisible();
  for (const width of [1600, 769, 375, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const layout = await header.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const title = element.querySelector('h1')!.getBoundingClientRect();
      const tools = element.querySelector('.room-header-tools')!.getBoundingClientRect();
      const button = element.querySelector('button')!;
      const badge = element.querySelector('[data-testid="connection-status"] .status-pill')!;
      const round = document.querySelector('[data-testid="round-board"]')!;
      const roundBounds = round.getBoundingClientRect();
      const table = document.querySelector('.table-panel')!;
      return {
        titleFits: title.right <= bounds.right,
        toolsRightAligned: Math.abs(tools.right - bounds.right) < 2,
        toolsAboveTable: tools.bottom < table.getBoundingClientRect().top,
        copyHeight: button.getBoundingClientRect().height,
        copyFont: parseFloat(getComputedStyle(button).fontSize),
        badgeHeight: badge.getBoundingClientRect().height,
        badgeFont: parseFloat(getComputedStyle(badge).fontSize),
        badgeRadius: getComputedStyle(badge).borderRadius,
        copyRadius: getComputedStyle(button).borderRadius,
        roundOutside: !table.contains(round),
        roundAbove: roundBounds.bottom <= table.getBoundingClientRect().top,
        roundSingleLine: Math.abs(round.querySelector('h2')!.getBoundingClientRect().top
          - round.querySelector('[data-testid="round-status"]')!.getBoundingClientRect().top) < 10,
        overflowing: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });
    expect(layout.titleFits).toBe(true);
    expect(layout.toolsRightAligned).toBe(true);
    expect(layout.toolsAboveTable).toBe(true);
    expect(layout.copyHeight).toBeLessThanOrEqual(36);
    expect(layout.copyFont).toBeLessThanOrEqual(13);
    expect(Math.abs(layout.copyHeight - layout.badgeHeight)).toBeLessThanOrEqual(1);
    expect(layout.copyFont).toBe(layout.badgeFont);
    expect(layout.copyRadius).toBe(layout.badgeRadius);
    expect(layout.roundOutside).toBe(true);
    expect(layout.roundAbove).toBe(true);
    expect(layout.roundSingleLine).toBe(true);
    expect(layout.overflowing).toBe(false);
    if (width === 1600 || width === 375) {
      await page.screenshot({ path: testInfo.outputPath(`room-header-${width}.png`), fullPage: true });
    }
  }
});
