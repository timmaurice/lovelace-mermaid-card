import { test, expect } from './fixtures/hass';
import {
  BASE_URL,
  readTokens,
  removeAutomation,
  removeState,
  saveAutomation,
  setState,
  useDashboard,
} from './helpers/homeassistant';

const DOOR = 'sensor.e2e_door';
const AWAY = 'binary_sensor.e2e_away';
const AUTOMATION = 'automation.e2e_door_flow';

// Only posted states and events: nothing here needs an integration, so a fresh Home Assistant runs it.
const CONFIG = {
  id: 'e2e_door_flow',
  alias: 'E2E door flow',
  mode: 'queued',
  triggers: [{ trigger: 'state', entity_id: DOOR, alias: 'Door changed' }],
  conditions: [{ condition: 'state', entity_id: AWAY, state: 'off' }],
  actions: [
    {
      choose: [
        {
          conditions: [{ condition: 'state', entity_id: DOOR, state: 'open' }],
          sequence: [{ event: 'e2e_door', event_data: { door: 'open' }, alias: 'Announce open' }],
        },
        {
          conditions: [{ condition: 'state', entity_id: DOOR, state: 'closed' }],
          sequence: [{ event: 'e2e_door', event_data: { door: 'closed' }, alias: 'Announce closed' }],
        },
      ],
      default: [{ event: 'e2e_door', event_data: { door: 'other' }, alias: 'Announce other' }],
    },
  ],
};

let urlPath: string;

test.beforeAll(async () => {
  await setState(DOOR, 'unknown', { friendly_name: 'E2E door' });
  await setState(AWAY, 'off', { friendly_name: 'E2E away' });
  await saveAutomation(CONFIG);
  // Saving reloads the automations; the entity shows up once that is done.
  await expect
    .poll(
      async () =>
        (
          await fetch(`${BASE_URL}/api/states/${AUTOMATION}`, {
            headers: { Authorization: `Bearer ${readTokens().access_token}` },
          })
        ).status,
      { timeout: 30_000 },
    )
    .toBe(200);
  urlPath = await useDashboard('automation', {
    views: [{ title: 'Automation', type: 'panel', cards: [{ type: 'custom:mermaid-card', automation: AUTOMATION }] }],
  });
});

test.afterAll(async () => {
  await removeAutomation(CONFIG.id);
  await removeState(DOOR);
  await removeState(AWAY);
});

test('draws an automation with the path of its last run, and follows the next run', async ({ page, consoleErrors }) => {
  await setState(DOOR, 'open', { friendly_name: 'E2E door' });
  await page.goto(`/${urlPath}/0`);
  const card = page.locator('mermaid-card');
  const ran = () =>
    card.evaluate((c) =>
      // A wrapped label is one tspan per line: read the lines with a space between them.
      [...c.shadowRoot!.querySelectorAll('.diagram .node.ran')].map((n) =>
        [...n.querySelectorAll('tspan, text:not(:has(tspan))')]
          .map((t) => t.textContent)
          .join(' ')
          .trim(),
      ),
    );

  await expect.poll(ran, { timeout: 30_000 }).toContain('Announce open');
  expect(await ran()).toEqual(expect.arrayContaining(['E2E door flow', 'Door changed', 'E2E away is off']));
  expect(await ran()).not.toContain('Announce closed');
  expect(await ran()).not.toContain('Announce other');
  expect(await card.locator('.diagram .edge-animation-slow').count()).toBeGreaterThan(0);
  await expect(card.locator('ha-alert')).toHaveCount(0);

  // The next run redraws the path: now through the other branch.
  await setState(DOOR, 'closed', { friendly_name: 'E2E door' });
  await expect.poll(ran, { timeout: 30_000 }).toContain('Announce closed');
  expect(await ran()).not.toContain('Announce open');

  // The start node is bound to the automation: a tap opens its details.
  await card.locator('.node[data-id="start"]').click();
  await expect(page.locator('ha-more-info-dialog')).toContainText('E2E door flow');
  expect(consoleErrors).toEqual([]);
});
