import { expect, test, type BrowserContext } from '@playwright/test';
import { createRoom, joinExistingRoom, joinRoom } from './helpers';
import { createOnlineRoomFixture } from '../scripts/room-fixtures.mjs';

test('two browser contexts vote, reveal, and archive a round', async ({ browser }) => {
  let hostContext: BrowserContext | undefined;
  let voterContext: BrowserContext | undefined;
  try {
    hostContext = await browser.newContext();
    voterContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const voterPage = await voterContext.newPage();
    await createRoom(hostPage, 'Sprint 24', 'Host');
    const code = await hostPage.getByTestId('room-code').textContent();
    if (!code) {
      throw new Error('Room creation did not render a room code.');
    }
    await joinRoom(voterPage, code, 'Voter');
    await expect(hostPage.getByTestId('distribution-bars')).not.toBeVisible();
    await voterPage.getByRole('button', { name: /^5$/ }).click();
    await hostPage.getByTestId('reveal-button').click();
    await expect(voterPage.getByTestId('distribution-bars')).toBeVisible();
    await hostPage.getByLabel(/final estimate/i).fill('5');
    await hostPage.getByRole('button', { name: /archive/i }).click();
    await expect(hostPage.getByRole('button', { name: /next round/i })).toBeVisible();
  } finally {
    await Promise.all([hostContext?.close(), voterContext?.close()]);
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
    await expect(observerPage.getByRole('complementary')).toBeVisible();
    await expect(observerPage.getByRole('group', { name: /fibonacci cards/i })).not.toBeVisible();
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
    await expect(page.getByTestId('join-error')).toHaveText(/100 members/i);
  } finally {
    try {
      await context?.close();
    } finally {
      await fixture.dispose();
    }
  }
});
