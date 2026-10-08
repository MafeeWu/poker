import { expect, test } from '@playwright/test';
import { joinExistingRoom } from './helpers';

test('reduced motion preserves final card and distribution states', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await joinExistingRoom(page, 'AB12CD34', 'Reduced Motion', 'voter');
  await expect(page.getByTestId('round-status')).toHaveText(/revealed/i);
  await expect(page.getByTestId('distribution-bars')).toBeVisible();
});
