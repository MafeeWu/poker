import { expect, test } from '@playwright/test';
import { createRoom, joinExistingRoom, joinRoom } from './helpers';

test('two browser contexts vote, reveal, and archive a round', async ({ browser }) => {
  const hostContext = await browser.newContext();
  const voterContext = await browser.newContext();

  const hostPage = await hostContext.newPage();
  const voterPage = await voterContext.newPage();

  await createRoom(hostPage, 'Sprint 24', 'Host');
  const code = await hostPage.getByTestId('room-code').textContent();
  await joinRoom(voterPage, code || 'AB12CD34', 'Voter');
  await voterPage.getByRole('button', { name: /^5$/ }).click();
  await hostPage.getByRole('button', { name: /reveal/i }).click();
  await expect(voterPage.getByTestId('distribution-bars')).toBeVisible();

  await hostContext.close();
  await voterContext.close();
});

test('an observer sees the room but has no vote controls', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  await joinExistingRoom(page, 'AB12CD34', 'Observer', 'observer');
  await expect(page.getByTestId('member-rail')).toBeVisible();
  await expect(page.getByRole('group', { name: /fibonacci cards/i })).not.toBeVisible();

  await context.close();
});

test('a room at capacity rejects the next join', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  await joinExistingRoom(page, 'FULLROOM', 'One Hundred One', 'voter');
  await expect(page.getByTestId('join-error')).toHaveText(/100 members/i);

  await context.close();
});
