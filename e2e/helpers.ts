import { expect, type Page } from '@playwright/test';

export function roomCode(page: Page): string {
  const match = new URL(page.url()).pathname.match(/^\/room\/([A-Z0-9]{8})$/);
  if (!match) throw new Error('Expected a room URL containing its share code.');
  return match[1];
}

export async function createRoom(page: Page, name: string, nickname: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /create project/i }).click();
  await page.getByLabel(/project name/i).fill(name);
  await page.getByLabel(/nickname/i).fill(nickname);
  await page.getByRole('button', { name: /^create$/i }).click();
  await expect(page).toHaveURL(/\/room\/[A-Z0-9]{8}$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
}

export async function joinRoom(page: Page, code: string, nickname: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /join project/i }).click();
  await page.getByLabel(/room code/i).fill(code);
  await page.getByLabel(/nickname/i).fill(nickname);
  await page.getByRole('button', { name: /^join$/i }).click();
  await expect(page.getByTestId('round-status')).toBeVisible();
}

export async function joinExistingRoom(
  page: Page,
  code: string,
  nickname: string,
  role: 'voter' | 'observer',
): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /join project/i }).click();
  await page.getByLabel(/room code/i).fill(code);
  await page.getByLabel(/nickname/i).fill(nickname);
  await page.getByRole('radio', { name: new RegExp(`^${role}$`, 'i') }).check();
  await page.getByRole('button', { name: /^join$/i }).click();
  await expect(page.getByTestId('round-status').or(page.getByTestId('join-error'))).toBeVisible();
}
