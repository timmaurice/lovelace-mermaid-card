import { describe, expect, it, vi } from 'vitest';
import { iconNames, registerIcons } from '../src/icons';
import type { MermaidApi } from '../src/mermaid';

// Home Assistant's ha-icon as far as the card uses it: it draws the path of a name it knows in an
// ha-svg-icon, a while after it was connected, and an empty one for a name it does not know.
const PATHS: Record<string, string> = { 'mdi:heat-pump': 'M1,1Z', 'mdi:fan': 'M2,2Z', 'hass:lightbulb': 'M3,3Z' };
customElements.define(
  'ha-icon',
  class extends HTMLElement {
    icon = '';
    connectedCallback() {
      const svg = document.createElement('ha-svg-icon') as HTMLElement & { path?: string };
      this.attachShadow({ mode: 'open' }).append(svg);
      setTimeout(() => (svg.path = PATHS[this.icon]), 10);
    }
  },
);

const fakeMermaid = () =>
  ({ registerIconPacks: vi.fn() }) as unknown as MermaidApi & { registerIconPacks: ReturnType<typeof vi.fn> };
const lastPacks = (mermaid: ReturnType<typeof fakeMermaid>) =>
  Object.fromEntries(
    (mermaid.registerIconPacks.mock.lastCall![0] as { name: string; icons: { icons: object } }[]).map((pack) => [
      pack.name,
      Object.keys(pack.icons.icons),
    ]),
  );

describe('iconNames', () => {
  it('finds icon shapes and architecture icons, once each', () => {
    const text = [
      'flowchart LR',
      'HP@{ icon: "mdi:heat-pump", label: "Heat pump" }',
      "F@{ shape: icon, icon: 'mdi:fan' }",
      'L@{icon:hass:lightbulb}',
      'X@{ icon: "mdi:heat-pump" }',
      'T(12:30) --> HP',
      'service db(mdi:database)[Database] in api',
      'group api(cloud)[API]',
    ].join('\n');
    expect(iconNames(text)).toEqual(['mdi:heat-pump', 'mdi:fan', 'hass:lightbulb', 'mdi:database']);
  });
});

describe('registerIcons', () => {
  it('registers the icons Home Assistant knows, one pack per prefix, and leaves out the rest', async () => {
    vi.useFakeTimers();
    const mermaid = fakeMermaid();
    const done = registerIcons(
      mermaid,
      'A@{ icon: "mdi:heat-pump" }\nB@{ icon: "hass:lightbulb" }\nC@{ icon: "mdi:nope" }',
    );
    await vi.runAllTimersAsync();
    await done;
    vi.useRealTimers();
    expect(lastPacks(mermaid)).toEqual({ mdi: ['heat-pump'], hass: ['lightbulb'] });
    const [mdi] = mermaid.registerIconPacks.mock.lastCall![0] as { icons: { icons: Record<string, unknown> } }[];
    expect(mdi.icons.icons['heat-pump']).toEqual({
      body: '<path fill="currentColor" d="M1,1Z"/>',
      left: 0,
      top: 0,
      width: 24,
      height: 24,
    });
  });

  it('keeps one card’s icons when another card registers its own before the first one renders', async () => {
    const mermaid = fakeMermaid();
    await registerIcons(mermaid, 'A@{ icon: "mdi:fan" }');
    await registerIcons(mermaid, 'B@{ icon: "hass:lightbulb" }');
    expect(lastPacks(mermaid).mdi).toContain('fan');
  });

  it('does nothing for a diagram without icons', async () => {
    const mermaid = fakeMermaid();
    await registerIcons(mermaid, 'A --> B');
    expect(mermaid.registerIconPacks).not.toHaveBeenCalled();
  });
});
