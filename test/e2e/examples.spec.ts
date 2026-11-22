import { test, expect } from './fixtures/hass';
import { useDashboard } from './helpers/homeassistant';
import { DIAGRAM_TYPES, EXAMPLES } from '../../src/header';

// The editor's examples read live states every installation has. A fresh Home Assistant, as in CI,
// is the test: each must render there without an alert.
test("the editor's examples render on a fresh Home Assistant", async ({ page, consoleErrors }) => {
  const urlPath = await useDashboard('examples', {
    views: [
      {
        title: 'Examples',
        type: 'panel',
        cards: [
          {
            type: 'vertical-stack',
            cards: DIAGRAM_TYPES.map((type) => ({
              type: 'custom:mermaid-card',
              title: type,
              diagram_type: type,
              content: EXAMPLES[type],
            })),
          },
        ],
      },
    ],
  });
  await page.setViewportSize({ width: 820, height: 900 });
  await page.goto(`/${urlPath}/0`);
  const cards = page.locator('mermaid-card');
  await expect(cards.locator('svg[aria-roledescription]')).toHaveCount(DIAGRAM_TYPES.length, { timeout: 60_000 });
  await expect(cards.locator('ha-alert')).toHaveCount(0);
  // The templates ran: no example shows a raw `{{` or `{%`.
  for (const card of await cards.all())
    await expect(card.locator('svg[aria-roledescription]')).not.toContainText(/\{\{|\{%/);
  expect(consoleErrors).toEqual([]);
});
