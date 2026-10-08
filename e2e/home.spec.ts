import { expect, test } from '@playwright/test';
import { createRoom } from './helpers';

test('creates a room and copies its share link', async ({ page }) => {
  await createRoom(page, 'Sprint 24', 'Host');
  await expect(page.getByTestId('room-code')).toHaveText(/[A-Z0-9]{8}/);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: /copy share link/i }).click();
  await expect(page.getByRole('status')).toHaveText(/copied/i);
});
