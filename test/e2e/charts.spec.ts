import { test, expect } from './fixtures/hass';
import { removeState, setState, useDashboard } from './helpers/homeassistant';

// Bindings outside flowcharts: by id (Gantt, kanban) and by label (mind map, pie, sankey).
// These lean on how Mermaid draws each type, so a Mermaid update that changes it fails here.
const LAMP = 'light.e2e_lamp';

const card = (content: string, entities: Record<string, string>) => ({
  type: 'custom:mermaid-card',
  content,
  entities,
});

let urlPath: string;

test.beforeAll(async () => {
  await setState(LAMP, 'on', { friendly_name: 'E2E lamp' });
  urlPath = await useDashboard('charts', {
    views: [
      {
        title: 'Charts',
        type: 'panel',
        cards: [
          {
            type: 'vertical-stack',
            cards: [
              card('mindmap\nroot((Home))\n  kitchen[Kitchen]\n  hall("Lamp (hall)")', { 'Lamp (hall)': LAMP }),
              // `Tiny` rounds to 0 %: Mermaid draws no slice for it but keeps its legend entry.
              card('pie\n  "Tiny" : 0.1\n  "Washer" : 30\n  "Dryer" : 70', { Dryer: LAMP }),
              card('gantt\n  dateFormat YYYY-MM-DD\n  Wash :wash, 2026-01-01, 1d', { wash: LAMP }),
              card('kanban\n  todo[Todo]\n    card1[Clean filter]', { card1: LAMP }),
              card('sankey-beta\nSolar,House,5\nGrid,House,2', { Grid: LAMP }),
            ],
          },
        ],
      },
    ],
  });
});

test.afterAll(async () => {
  await removeState(LAMP);
});

const fill = (element: { evaluate: (fn: (e: Element) => string) => Promise<string> }) =>
  element.evaluate((e) => (e as SVGElement).style.fill);

test('binds Gantt tasks and kanban items by id, mind maps, pies and sankeys by label', async ({
  page,
  consoleErrors,
}) => {
  await page.goto(`/${urlPath}/0`);
  const cards = page.locator('mermaid-card');
  await expect(cards.locator('svg[aria-roledescription]')).toHaveCount(5, { timeout: 30_000 });
  const [mindmap, pie, gantt, kanban, sankey] = [0, 1, 2, 3, 4].map((n) => cards.nth(n));
  const more = page.locator('ha-more-info-dialog');

  const targets = [
    mindmap.locator('.mindmap-node', { hasText: 'Lamp (hall)' }),
    pie.locator('.pieCircle').nth(1), // the second drawn slice is Dryer, the third legend entry
    pie.locator('.legend', { hasText: 'Dryer' }),
    gantt.locator('rect.task'),
    kanban.locator('.node[data-id="n:card1"]'),
    sankey.locator('.node-labels text', { hasText: 'Grid' }),
  ];
  for (const target of targets) {
    await expect(target).toHaveAttribute('role', 'button');
    await target.click();
    await expect(more).toContainText('E2E lamp');
    await page.keyboard.press('Escape');
    await expect(more).toBeHidden();
  }

  // Only the bound ones: the other slice, legend entry and mind map node stay as drawn.
  await expect(pie.locator('.pieCircle').first()).not.toHaveAttribute('role', 'button');
  await expect(pie.locator('.legend', { hasText: 'Washer' })).not.toHaveAttribute('role', 'button');
  await expect(mindmap.locator('.mindmap-node', { hasText: 'Kitchen' })).not.toHaveAttribute('role', 'button');

  // Nodes take the state colour; chart slices keep theirs.
  await expect.poll(() => fill(gantt.locator('rect.task'))).toContain('--state-light-active-color');
  await expect
    .poll(() => fill(kanban.locator('.node[data-id="n:card1"] > rect')))
    .toContain('--state-light-active-color');
  await expect
    .poll(() => fill(mindmap.locator('.mindmap-node', { hasText: 'Lamp (hall)' }).locator('rect, path').first()))
    .toContain('--state-light-active-color');
  // A mind map's section text is white, unreadable on the tint: the label takes the theme's.
  expect(
    await mindmap
      .locator('.mindmap-node', { hasText: 'Lamp (hall)' })
      .locator('text')
      .first()
      .evaluate((text) => text.style.getPropertyValue('fill')),
  ).toBe('var(--primary-text-color)');
  expect(await fill(pie.locator('.pieCircle').nth(1))).toBe('');
  expect(consoleErrors).toEqual([]);
});

test('the editor lists ids and labels as binding keys for every bindable type', async ({ page }) => {
  await page.goto(`/${urlPath}/0`);
  await page.locator('mermaid-card svg[aria-roledescription]').first().waitFor({ timeout: 30_000 });
  // The panel view has no per-card edit mode, so build the card's editor directly.
  const nodes = (content: string) =>
    page.evaluate(async (content) => {
      type Editor = HTMLElement & { hass: unknown; setConfig(c: object): void; _nodes: { id: string }[] };
      const card = customElements.get('mermaid-card') as unknown as { getConfigElement(): Promise<Editor> | Editor };
      const editor = await card.getConfigElement();
      editor.hass = (document.querySelector('home-assistant') as unknown as { hass: unknown }).hass;
      editor.setConfig({ type: 'custom:mermaid-card', content });
      document.body.append(editor);
      for (let i = 0; i < 50 && !editor._nodes.length; i++) await new Promise((r) => setTimeout(r, 100));
      editor.remove();
      return editor._nodes.map((node) => node.id);
    }, content);
  // As the node shows it: a line break is a space, markdown is its text.
  expect(await nodes('mindmap\nroot((Home))\n  kitchen[Kitchen<br>down]\n  hall("Lamp (hall)")\n  **Bath**')).toEqual([
    'Home',
    'Kitchen down',
    'Lamp (hall)',
    'Bath',
  ]);
  expect(await nodes('pie\n  "Washer" : 30\n  "Dryer" : 70')).toEqual(['Washer', 'Dryer']);
  expect(await nodes('gantt\n  dateFormat YYYY-MM-DD\n  Wash :wash, 2026-01-01, 1d')).toEqual(['wash']);
  expect(await nodes('kanban\n  todo[Todo]\n    card1[Clean filter]')).toEqual(['todo', 'card1']);
  expect(await nodes('sankey-beta\nSolar,House,5')).toEqual(['Solar', 'House']);
});
