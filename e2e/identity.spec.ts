import { mkdir, rm } from 'node:fs/promises';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createRoom, joinExistingRoom } from './helpers';

function memberCard(page: Page, nickname: string) {
  return page.getByTestId('member-grid').locator('li').filter({ hasText: nickname });
}

test('reload restores the host identity, vote and host controls without adding a member', async ({ page }) => {
  await createRoom(page, 'Host recovery fixture', 'Returning Host');
  const card = memberCard(page, 'Returning Host');
  const memberId = await card.getAttribute('data-testid');
  await page.getByRole('button', { name: '5', exact: true }).click();
  await expect(card).toHaveAttribute('data-vote-status', 'voted');
  await page.reload();

  await expect(page.getByTestId('member-count')).toHaveText(/^1 members?$/);
  await expect(card).toHaveAttribute('data-testid', memberId!);
  await expect(card.locator('.member-role')).toHaveText('host');
  await expect(page.getByRole('button', { name: '5 selected', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: 'Join this room' })).toHaveCount(0);
  await page.getByTestId('reveal-button').click();
  await expect(card.getByTestId('member-card-front')).toHaveText('5');
});

test('closing and reopening the browser profile restores the original voter and vote', async ({ browser }, testInfo) => {
  const profile = testInfo.outputPath('returning-voter-profile');
  await mkdir(profile, { recursive: true });
  const hostContext = await browser.newContext();
  let guestBrowser: BrowserContext | undefined;
  try {
    const hostPage = await hostContext.newPage();
    await createRoom(hostPage, 'Browser restart fixture', 'Restart Host');
    const code = (await hostPage.getByTestId('room-code').innerText()).trim();
    guestBrowser = await chromium.launchPersistentContext(profile, { baseURL: testInfo.project.use.baseURL });
    const guestPage = await guestBrowser.newPage();
    await joinExistingRoom(guestPage, code, 'Restart Voter', 'voter');
    const memberId = await memberCard(guestPage, 'Restart Voter').getAttribute('data-testid');
    await guestPage.getByRole('button', { name: '8', exact: true }).click();
    await expect(memberCard(hostPage, 'Restart Voter')).toHaveAttribute('data-vote-status', 'voted');
    await guestBrowser.close();

    guestBrowser = await chromium.launchPersistentContext(profile, { baseURL: testInfo.project.use.baseURL });
    const reopenedPage = await guestBrowser.newPage();
    await reopenedPage.goto(`/room/${code}`);
    await expect(reopenedPage.getByTestId('member-count')).toHaveText('2 members');
    await expect(memberCard(reopenedPage, 'Restart Voter')).toHaveAttribute('data-testid', memberId!);
    await expect(memberCard(reopenedPage, 'Restart Voter').locator('.member-role')).toHaveText('voter');
    await expect(reopenedPage.getByRole('button', { name: '8 selected', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(reopenedPage.getByTestId('reveal-button')).toHaveCount(0);
    await hostPage.getByTestId('reveal-button').click();
    await expect(memberCard(reopenedPage, 'Restart Voter').getByTestId('member-card-front')).toHaveText('8');
  } finally {
    await Promise.all([hostContext.close(), guestBrowser?.close()]);
    await rm(profile, { recursive: true, force: true });
  }
});

test('normal tabs share one member and restore rooms without recent-room history', async ({ context, page }) => {
  await createRoom(page, 'Tab identity fixture', 'Tab Host');
  const code = (await page.getByTestId('room-code').innerText()).trim();
  const memberId = await memberCard(page, 'Tab Host').getAttribute('data-testid');
  await page.evaluate(() => localStorage.removeItem('poker.recentRooms'));
  const secondPage = await context.newPage();
  await secondPage.goto(`/room/${code}`);
  await expect(secondPage.getByTestId('member-count')).toHaveText(/^1 members?$/);
  await expect(memberCard(secondPage, 'Tab Host')).toHaveAttribute('data-testid', memberId!);
  await secondPage.getByRole('button', { name: '3', exact: true }).click();
  await expect(page.getByRole('button', { name: '3 selected', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await secondPage.close();
  await page.reload();
  await expect(page.getByRole('button', { name: '3 selected', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('expired persisted access sessions refresh without losing member identity', async ({ page }) => {
  await createRoom(page, 'Token refresh fixture', 'Refresh Host');
  const memberId = await memberCard(page, 'Refresh Host').getAttribute('data-testid');
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((entry) => entry.endsWith('-auth-token'));
    if (!key) throw new Error('No persisted guest session found');
    const session = JSON.parse(localStorage.getItem(key)!);
    session.expires_at = Math.floor(Date.now() / 1000) - 60;
    localStorage.setItem(key, JSON.stringify(session));
  });
  const refreshed = page.waitForResponse((response) => (
    response.url().includes('/auth/v1/token?grant_type=refresh_token') && response.ok()
  ));
  await page.reload();
  await refreshed;
  await expect(memberCard(page, 'Refresh Host')).toHaveAttribute('data-testid', memberId!);
  await page.getByRole('button', { name: '13', exact: true }).click();
  await expect(memberCard(page, 'Refresh Host')).toHaveAttribute('data-vote-status', 'voted');
  await expect(page.getByTestId('member-count')).toHaveText(/^1 members?$/);
});

test('simultaneous first-use tabs retain a single browser identity for both rooms', async ({ context }) => {
  let signups = 0;
  context.on('request', (request) => {
    if (new URL(request.url()).pathname === '/auth/v1/signup') signups += 1;
  });
  const firstPage = await context.newPage();
  const secondPage = await context.newPage();
  await Promise.all([firstPage, secondPage].map(async (page, index) => {
    await page.goto('/');
    await page.getByRole('button', { name: /create project/i }).click();
    await page.getByLabel('Project name').fill(`First-use tab ${index + 1}`);
    await page.getByLabel('Nickname').fill(`Tab creator ${index + 1}`);
  }));
  await Promise.all([firstPage, secondPage].map((page) => (
    page.getByRole('button', { name: 'Create', exact: true }).click()
  )));
  for (const page of [firstPage, secondPage]) {
    await expect(page.getByTestId('room-code')).toBeVisible();
  }
  await Promise.all([firstPage.reload(), secondPage.reload()]);
  for (const [index, page] of [firstPage, secondPage].entries()) {
    await expect(page.getByTestId('member-count')).toHaveText(/^1 members?$/);
    await expect(memberCard(page, `Tab creator ${index + 1}`).locator('.member-role')).toHaveText('host');
    await expect(page.getByTestId('reveal-button')).toBeVisible();
  }
  expect(signups).toBe(1);
});

test('using the home join form for an existing room restores the host instead of renaming or demoting it', async ({ page }) => {
  await createRoom(page, 'Home return fixture', 'Original Host');
  const code = (await page.getByTestId('room-code').innerText()).trim();
  const memberId = await memberCard(page, 'Original Host').getAttribute('data-testid');
  await joinExistingRoom(page, code, 'Accidental new name', 'observer');

  await expect(page.getByTestId('member-count')).toHaveText(/^1 members?$/);
  await expect(memberCard(page, 'Original Host')).toHaveAttribute('data-testid', memberId!);
  await expect(memberCard(page, 'Original Host').locator('.member-role')).toHaveText('host');
  await expect(memberCard(page, 'Accidental new name')).toHaveCount(0);
  await page.getByRole('button', { name: '5', exact: true }).click();
  await page.getByTestId('reveal-button').click();
  await expect(memberCard(page, 'Original Host').getByTestId('member-card-front')).toHaveText('5');
});
