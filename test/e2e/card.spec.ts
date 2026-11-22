import { test, expect } from './fixtures/hass';
import { removeState, setState, useDashboard } from './helpers/homeassistant';

const PUMP = 'switch.e2e_heat_pump';
const BOILER = 'sensor.e2e_boiler';

const CONTENT = `flowchart LR
  HP[Heat pump] --> BOIL[("Boiler<br>{{ states('${BOILER}') }} °C")]`;

let urlPath: string;

test.beforeAll(async () => {
  await setState(PUMP, 'off', { friendly_name: 'E2E heat pump' });
  await setState(BOILER, '58.4', { friendly_name: 'E2E boiler', unit_of_measurement: '°C' });
  urlPath = await useDashboard('card', {
    views: [
      {
        title: 'Mermaid',
        type: 'sections',
        sections: [
          {
            type: 'grid',
            cards: [{ type: 'custom:mermaid-card', title: 'Heating', content: CONTENT, entities: { HP: PUMP } }],
          },
        ],
      },
    ],
  });
});

test.afterAll(async () => {
  await removeState(PUMP);
  await removeState(BOILER);
});

test('renders live template values and follows the bound entity', async ({ page, consoleErrors }) => {
  await page.goto(`/${urlPath}/0`);
  const card = page.locator('mermaid-card');
  const pump = card.locator('.node[id*="-flowchart-HP-"]');
  const boiler = card.locator('.node[id*="-flowchart-BOIL-"]');
  const pumpFill = () =>
    pump
      .locator('path, rect, polygon')
      .first()
      .evaluate((shape) => (shape as SVGElement).style.fill);

  await expect(boiler).toContainText('58.4 °C', { timeout: 30_000 });
  await expect.poll(pumpFill).toContain('--state-switch-inactive-color');

  await setState(BOILER, '61.0', { friendly_name: 'E2E boiler', unit_of_measurement: '°C' });
  await setState(PUMP, 'on', { friendly_name: 'E2E heat pump' });
  await expect(boiler).toContainText('61.0 °C');
  await expect.poll(pumpFill).toContain('--state-switch-active-color');

  await pump.click();
  await expect(page.locator('ha-more-info-dialog')).toContainText('E2E heat pump');
  expect(consoleErrors).toEqual([]);
});

test('the editor lists the diagram nodes for binding', async ({ page }) => {
  await page.goto(`/${urlPath}/0?edit=1`);
  await page.locator('mermaid-card').waitFor();
  await page.locator('hui-card-edit-mode').first().click();
  const editor = page.locator('mermaid-card-editor');
  await expect(editor).toBeVisible({ timeout: 30_000 });

  // One row for the binding in the config, and both diagram nodes on offer.
  await expect(editor.locator('.row')).toHaveCount(1);
  await expect
    .poll(() =>
      editor.evaluate((element) => (element as unknown as { _nodes: { id: string }[] })._nodes.map((node) => node.id)),
    )
    .toEqual(['HP', 'BOIL']);
});
