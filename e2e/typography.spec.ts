import { expect, test } from '@playwright/test';
import { createRoom } from './helpers';

test('room numerals use the corner serif font without changing text fonts or homepage typography', async ({ page }, testInfo) => {
  await createRoom(page, 'Sprint 42', 'Host 24');
  const client = await page.context().newCDPSession(page);
  await client.send('DOM.enable');
  await client.send('CSS.enable');
  const renderedFonts = async (selector: string) => {
    await page.evaluate(() => document.fonts.ready);
    const { root } = await client.send('DOM.getDocument');
    const { nodeId } = await client.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    expect(nodeId).not.toBe(0);
    const { fonts } = await client.send('CSS.getPlatformFontsForNode', { nodeId });
    return fonts.filter((font) => font.glyphCount > 0).map((font) => font.familyName);
  };
  const expectSerifNumerals = async (selector: string, mixedText = false) => {
    const fonts = await renderedFonts(selector);
    expect(fonts).toContain('Georgia');
    if (mixedText) expect(fonts.some((font) => font !== 'Georgia')).toBe(true);
  };

  for (const selector of ['.room-header h1', '[data-testid="member-count"]', '.round-title h2', '.member-name']) {
    await expectSerifNumerals(selector, true);
  }
  const cards = page.getByRole('group', { name: 'Fibonacci cards' });
  await expect(cards.locator('.card-corner')).toHaveText([
    '♣', '♣', '♦', '♦', '♠', '♠', '♥', '♥', '♣', '♣', '♦', '♦', '♠', '♠',
    '♥', '♥', '♣', '♣', '♦', '♦', '♠', '♠', '♥', '♥', '★', '★',
  ]);
  const cornerSizes = await cards.locator('.card-corner').evaluateAll((corners) =>
    corners.map((corner) => parseFloat(getComputedStyle(corner).fontSize)),
  );
  expect(cornerSizes.every((size) => size >= 14)).toBe(true);
  const families = await cards.locator('.card-rank').evaluateAll((ranks) =>
    ranks.map((rank) => getComputedStyle(rank).fontFamily),
  );
  expect(families.every((family) => family === 'Georgia, serif')).toBe(true);
  await expectSerifNumerals('.card-button:nth-child(6) .card-rank');
  await expectSerifNumerals('.card-button:nth-child(2) .card-rank');
  await page.screenshot({ path: testInfo.outputPath('numerals-voting.png'), fullPage: true });

  await page.getByRole('button', { name: '5', exact: true }).click();
  await page.getByTestId('reveal-button').click();
  await expect(page.getByTestId('member-card-front')).toHaveText('5');
  await expect(page.getByLabel('Final estimate')).toHaveValue('5');
  await page.getByLabel('Final estimate').press('Tab');
  await expect(page.getByTestId('final-estimate-value')).toHaveText('Final estimate: 5');
  for (const selector of ['.member-vote-card--front span', '.distribution-label', '.distribution-count', '[data-testid="final-estimate-value"]']) {
    await expectSerifNumerals(selector);
  }
  await expect(page.getByLabel('Final estimate')).toHaveCSS('font-family', /Room Numerals/);
  await expect(page.getByLabel('Note')).toHaveCSS('font-family', /Room Numerals/);
  await expectSerifNumerals('#round-note-count', true);
  await page.getByLabel('Note').fill('Story 123');
  await page.getByRole('button', { name: 'Next round', exact: true }).click();
  await expect(page.getByTestId('round-board').getByRole('heading')).toHaveText('Round 2');
  for (const selector of ['.round-title h2', '.round-history h3', '.round-history li p:first-of-type', '.round-history li p:last-of-type']) {
    await expectSerifNumerals(selector, true);
  }
  await page.screenshot({ path: testInfo.outputPath('numerals-history.png'), fullPage: true });
  await page.goto('/');
  await page.getByRole('button', { name: /create project/i }).click();
  await expect(page.getByLabel('Nickname')).not.toHaveCSS('font-family', /Room Numerals/);
});
