import { expect, test } from '@playwright/test';
import type { RoomSnapshotJson } from '../src/lib/database.types';
import { createRoom, joinExistingRoom, roomCode } from './helpers';

test('idle open clients renew presence past server expiry and recover from heartbeat failure without reloading', async ({ browser }) => {
  test.setTimeout(140_000);
  const hostContext = await browser.newContext();
  const memberContext = await browser.newContext();
  try {
    const host = await hostContext.newPage();
    const member = await memberContext.newPage();
    const snapshots: RoomSnapshotJson[] = [];
    member.on('response', async (response) => {
      if (response.url().endsWith('/rpc/build_room_snapshot') && response.ok()) {
        snapshots.push(await response.json());
      }
    });
    await createRoom(host, 'Idle presence fixture', 'Idle Host');
    await joinExistingRoom(member, roomCode(host), 'Idle Member', 'voter');
    await expect(member.getByTestId('member-count')).toHaveText('2 members');
    await expect(member.getByTestId('connection-status')).toHaveText('Connected');
    const card = host.getByTestId('member-grid').locator('li').filter({ hasText: 'Idle Member' });
    await expect(card).toHaveAccessibleName(/Idle Member, voter, Online, Waiting/);
    await expect.poll(() => snapshots.length).toBeGreaterThan(0);
    const initialSeen = snapshots.at(-1)!.members.find((entry) => entry.nickname === 'Idle Member')!.lastSeenAt;
    const started = Date.now();
    // Deliberately cross the database's real 90-second expiry without activity or a reload.
    await new Promise((resolve) => setTimeout(resolve, 95_000));
    expect(Date.now() - started).toBeGreaterThan(90_000);
    await expect.poll(() => snapshots.at(-1)!.members.find((entry) => entry.nickname === 'Idle Member')!.lastSeenAt).not.toBe(initialSeen);
    const latest = snapshots.at(-1)!;
    expect(latest.members.every((entry) => entry.online)).toBe(true);
    expect(Date.now() - Date.parse(latest.members.find((entry) => entry.nickname === 'Idle Member')!.lastSeenAt)).toBeLessThan(40_000);
    await expect(card).toHaveAttribute('data-card-state', 'pending');
    await expect(member.getByTestId('connection-status')).toHaveText('Connected');

    await member.route('**/rest/v1/rpc/heartbeat_member', (route) => route.fulfill({
      status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Presence temporarily unavailable' }),
    }));
    await member.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(member.getByRole('status').filter({ hasText: 'Presence temporarily unavailable' })).toBeVisible();
    await expect(member.getByTestId('connection-status')).toHaveText('Connection error');
    await expect(member.getByRole('button', { name: '5 disabled', exact: true })).toBeDisabled();
    await member.unrouteAll({ behavior: 'wait' });
    await member.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(member.getByTestId('connection-status')).toHaveText('Connected');
    await expect(member.getByText('Presence temporarily unavailable')).toHaveCount(0);
    await expect(member.getByRole('button', { name: '5', exact: true })).toBeEnabled();
    await expect(card).toHaveAccessibleName(/Idle Member, voter, Online, Waiting/);
  } finally {
    await Promise.all(memberContext.pages().map((page) => page.unrouteAll({ behavior: 'wait' })));
    await Promise.all([hostContext.close(), memberContext.close()]);
  }
});
