import { expect, test, type Locator } from '@playwright/test';
import { createRoom, joinExistingRoom, roomCode } from './helpers';
import type { RoomSnapshotJson } from '../src/lib/database.types';

async function expectCardLayout(card: Locator) {
  // Measure the resting layout, not the transient rotated bounds during a vote shake.
  await expect.poll(() => card.locator('.member-vote-flip').evaluate((element) =>
    element.getAnimations().some((animation) => animation.playState === 'running'),
  )).toBe(false);
  const layout = await card.evaluate((element) => {
    const style = getComputedStyle(element);
    const back = element.querySelector('.member-vote-flip')!;
    const name = element.querySelector('strong')!;
    const bounds = back.getBoundingClientRect();
    return {
      background: style.backgroundColor,
      border: parseFloat(style.borderWidth),
      shadow: style.boxShadow,
      width: bounds.width,
      ratio: bounds.height / bounds.width,
      nameBelow: name.getBoundingClientRect().top >= bounds.bottom,
    };
  });
  expect(layout.background).toBe('rgba(0, 0, 0, 0)');
  expect(layout.border).toBe(0);
  expect(layout.shadow).toBe('none');
  expect(layout.width).toBeGreaterThanOrEqual(96);
  expect(layout.width).toBeLessThanOrEqual(144);
  expect(layout.ratio).toBeCloseTo(1.5, 1);
  expect(layout.nameBelow).toBe(true);
}

test('large member cards keep stable suits across clients and distinct vote backgrounds without labels', async ({ browser }, testInfo) => {
  const hostContext = await browser.newContext();
  const voterContext = await browser.newContext();
  const observerContext = await browser.newContext();
  try {
    const host = await hostContext.newPage();
    const voter = await voterContext.newPage();
    const observer = await observerContext.newPage();
    await createRoom(host, 'Card style fixture', 'Card Host');
    const code = roomCode(host);
    await joinExistingRoom(voter, code, 'Card Voter', 'voter');
    await joinExistingRoom(observer, code, 'Card Guest', 'observer');
    const pages = [host, voter, observer];
    for (const page of pages) await expect(page.getByTestId('member-count')).toHaveText('3 members');
    const hostCard = host.getByTestId('member-grid').locator('li').filter({ hasText: 'Card Host' });
    const suit = await hostCard.getByTestId('member-card-back').innerText();
    for (const page of pages) {
      const card = page.getByTestId('member-grid').locator('li').filter({ hasText: 'Card Host' });
      await expect(card.getByTestId('member-card-back')).toHaveText(suit);
      await expect(card.getByRole('img', { name: 'Host', exact: true })).toBeVisible();
      await expectCardLayout(card);
      await expect(page.getByTestId('member-grid').getByText(/^(host|voter|observer|waiting|voted|online|offline)$/i)).toHaveCount(0);
    }
    const pendingBackground = await hostCard.getByTestId('member-card-back').evaluate((element) => getComputedStyle(element).backgroundImage);
    await host.getByRole('button', { name: '5', exact: true }).click();
    await expect(hostCard).toHaveAttribute('data-card-state', 'voted');
    const votedBackground = await hostCard.getByTestId('member-card-back').evaluate((element) => getComputedStyle(element).backgroundImage);
    expect(votedBackground).not.toBe(pendingBackground);
    await expect(hostCard.getByTestId('member-card-back')).toHaveText(suit);
    const observerCard = host.getByTestId('member-grid').locator('li').filter({ hasText: 'Card Guest' });
    await expect(observerCard).toHaveAttribute('data-card-state', 'observer');
    await expect(observerCard.getByTestId('member-card-back')).toBeVisible();
    expect(await observerCard.getByTestId('member-card-back').evaluate((element) => getComputedStyle(element).backgroundImage)).not.toBe(votedBackground);

    for (const width of [320, 375, 768, 769, 1440]) {
      await host.setViewportSize({ width, height: 900 });
      for (const card of await host.getByTestId('member-grid').locator('li').all()) await expectCardLayout(card);
      const historyLayout = await host.getByRole('region', { name: 'Round history' }).evaluate((history) => {
        const table = document.querySelector('.table-panel')!;
        const tableBounds = table.getBoundingClientRect();
        const historyBounds = history.getBoundingClientRect();
        return {
          outsideTable: !table.contains(history),
          toRight: historyBounds.left >= tableBounds.right,
          topDifference: Math.abs(historyBounds.top - tableBounds.top),
          belowTable: historyBounds.top >= tableBounds.bottom,
          width: historyBounds.width,
        };
      });
      expect(historyLayout.outsideTable).toBe(true);
      if (width > 768) {
        expect(historyLayout.toRight).toBe(true);
        expect(historyLayout.topDifference).toBeLessThanOrEqual(1);
        expect(historyLayout.width).toBe(280);
      } else {
        expect(historyLayout.belowTable).toBe(true);
      }
      expect(await host.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    }
    await host.reload();
    const restored = host.getByTestId('member-grid').locator('li').filter({ hasText: 'Card Host' });
    await expect(restored.getByTestId('member-card-back')).toHaveText(suit);
    await expect(restored).toHaveAttribute('data-card-state', 'voted');

    // Control presence in the snapshot without waiting for the 90-second expiry or editing the database.
    await host.route('**/rest/v1/rpc/build_room_snapshot', async (route) => {
      const response = await route.fetch();
      const snapshot: RoomSnapshotJson = await response.json();
      for (const member of snapshot.members) {
        if (member.nickname !== 'Card Guest') member.online = false;
      }
      await route.fulfill({ response, json: snapshot });
    });
    await host.reload();
    await expect(restored).toHaveAccessibleName(/Card Host, host, Offline, Voted/);
    await expect(restored).toHaveAttribute('data-card-state', 'voted');
    expect(await restored.getByTestId('member-card-back').evaluate((element) => getComputedStyle(element).backgroundImage)).toBe(votedBackground);
    const offlinePending = host.getByTestId('member-grid').locator('li').filter({ hasText: 'Card Voter' });
    await expect(offlinePending).toHaveAttribute('data-card-state', 'offline');
    const offlineBackground = await offlinePending.getByTestId('member-card-back').evaluate((element) => getComputedStyle(element).backgroundImage);
    expect(offlineBackground).not.toBe(votedBackground);
    expect(offlineBackground).not.toBe(pendingBackground);
    await host.screenshot({ path: testInfo.outputPath('member-cards-desktop.png'), fullPage: true });
    await host.setViewportSize({ width: 375, height: 812 });
    await host.screenshot({ path: testInfo.outputPath('member-cards-mobile.png'), fullPage: true });
  } finally {
    await Promise.all(hostContext.pages().map((page) => page.unrouteAll({ behavior: 'wait' })));
    await Promise.all([hostContext.close(), voterContext.close(), observerContext.close()]);
  }
});

for (const mode of ['create', 'join'] as const) {
  test(`${mode} button shows a real pending RPC and disables mode changes`, async ({ browser }) => {
    const hostContext = await browser.newContext();
    const context = await browser.newContext();
    let release: (() => void) | undefined;
    try {
      const page = await context.newPage();
      await page.goto('/');
      if (mode === 'join') {
        const host = await hostContext.newPage();
        await createRoom(host, 'Join loading fixture', 'Loading Host');
        const code = roomCode(host);
        await page.getByRole('button', { name: /join project/i }).click();
        await page.getByLabel('Room code').fill(code);
      }
      await page.getByLabel('Nickname').fill('Loading Member');
      const requestGate = new Promise<void>((resolve) => { release = resolve; });
      await page.route(`**/rest/v1/rpc/${mode}_room`, async (route) => {
        await requestGate;
        await route.continue();
      });
      await page.getByRole('button', { name: mode === 'create' ? 'Create' : 'Join', exact: true }).click();
      const button = page.getByRole('button', { name: mode === 'create' ? 'Creating…' : 'Joining…', exact: true });
      await expect(button).toBeDisabled();
      await expect(button.locator('.button-spinner')).toBeVisible();
      await expect(button.locator('.button-spinner')).toHaveCSS('animation-name', 'button-spin');
      await expect.poll(() => button.locator('.button-spinner').evaluate((element) =>
        element.getAnimations().filter((animation) => animation.playState === 'running').length,
      )).toBe(1);
      await expect(page.getByRole('button', { name: /join project/i })).toBeDisabled();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await expect(button.locator('.button-spinner')).toHaveCSS('animation-name', 'none');
      release!();
      await expect(page.getByTestId('round-board')).toBeVisible();
    } finally {
      release?.();
      await Promise.all([context.close(), hostContext.close()]);
    }
  });
}
