import { expect, test, type BrowserContext } from '@playwright/test';
import { createRoom, joinRoom } from './helpers';

test('reduced motion preserves final card and distribution states', async ({ browser }) => {
  let hostContext: BrowserContext | undefined;
  let voterContext: BrowserContext | undefined;
  try {
    hostContext = await browser.newContext({ reducedMotion: 'reduce' });
    voterContext = await browser.newContext({ reducedMotion: 'reduce' });
    const hostPage = await hostContext.newPage();
    const voterPage = await voterContext.newPage();
    await createRoom(hostPage, 'Reduced motion fixture', 'Host');
    const code = await hostPage.getByTestId('room-code').textContent();
    if (!code) {
      throw new Error('Room creation did not render a room code.');
    }
    await joinRoom(voterPage, code, 'Reduced Motion');
    await voterPage.getByRole('button', { name: /^5$/ }).click();
    await hostPage.getByTestId('reveal-button').click();
    await expect(hostPage.getByTestId('round-status')).toHaveText(/revealed/i);
    await expect(hostPage.getByTestId('distribution-bars')).toBeVisible();
    await expect(voterPage.getByTestId('round-status')).toHaveText(/revealed/i);
    await expect(voterPage.getByTestId('distribution-bars')).toBeVisible();
  } finally {
    await Promise.all([hostContext?.close(), voterContext?.close()]);
  }
});
