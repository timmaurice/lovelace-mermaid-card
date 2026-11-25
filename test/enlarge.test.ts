import { describe, expect, it, vi } from 'vitest';
import type { HassEntity, HomeAssistant } from '../src/types';

const render = vi.fn(async () => ({
  svg: '<svg viewBox="0 0 800 200"><g class="node" data-id="A"><rect></rect></g></svg>',
}));
vi.mock('../src/mermaid', () => ({
  loadMermaid: async () => ({ initialize: vi.fn(), render }),
  listNodes: async () => ({ nodes: [] }),
}));

const { MermaidCard } = await import('../src/mermaid-card');
const { clampView, zoomAt } = await import('../src/zoom');

// jsdom has no modal dialogs.
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.open = false;
  this.dispatchEvent(new Event('close'));
};

const makeHass = (state: string) =>
  ({
    states: { 'light.a': { entity_id: 'light.a', state, attributes: {} } as HassEntity },
    themes: { darkMode: false },
    connection: {},
  }) as unknown as HomeAssistant;

async function mount(): Promise<InstanceType<typeof MermaidCard>> {
  const card = new MermaidCard();
  card.setConfig({ type: 'custom:mermaid-card', content: 'flowchart LR\n A', entities: { A: 'light.a' } });
  card.hass = makeHass('off');
  document.body.append(card);
  await vi.waitFor(() => expect(card.shadowRoot!.querySelector('.diagram svg')).not.toBeNull());
  await card.updateComplete;
  return card;
}

describe('enlarged view', () => {
  it('opens a shrunk diagram at natural width in a dialog whose nodes stay bound', async () => {
    const card = await mount(); // jsdom lays nothing out, so the diagram counts as shrunk
    card.shadowRoot!.querySelector<HTMLElement>('.enlarge')!.click();
    const dialog = card.shadowRoot!.querySelector('dialog')!;
    expect(dialog.open).toBe(true);
    expect(dialog.getAttribute('aria-label')).toBe('Enlarged diagram'); // no title, so the generic name
    expect(dialog.querySelector<SVGSVGElement>('.enlarged svg')!.style.minWidth).toBe('800px');
    const rect = () => dialog.querySelector<SVGRectElement>('.enlarged rect')!;
    expect(rect().style.getPropertyValue('fill')).toContain('inactive');

    card.hass = makeHass('on');
    await card.updateComplete;
    expect(rect().style.getPropertyValue('fill')).toContain('--state-light-active-color');

    dialog.dispatchEvent(new MouseEvent('click')); // a click on the backdrop targets the dialog
    expect(dialog.open).toBe(false);
    expect(dialog.querySelector('.enlarged svg')).toBeNull();
  });

  it('zooms the dialog with the wheel and opens fitted again', async () => {
    const card = await mount();
    card.shadowRoot!.querySelector<HTMLElement>('.enlarge')!.click();
    const zoom = card.shadowRoot!.querySelector<HTMLElement>('.zoom')!;
    zoom.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, cancelable: true }));
    expect(zoom.querySelector('svg')!.style.transform).toMatch(/scale\(1\.2\d*\)/);

    card.shadowRoot!.querySelector('dialog')!.close();
    card.shadowRoot!.querySelector<HTMLElement>('.enlarge')!.click();
    expect(zoom.querySelector('svg')!.style.transform).toMatch(/ scale\(1\)$/);
  });

  it('offers no enlarged view for a diagram only a few pixels short of its natural size', async () => {
    const card = await mount();
    const svg = card.shadowRoot!.querySelector('.diagram svg')!;
    svg.getBoundingClientRect = () => ({ width: 798 }) as DOMRect; // jsdom has no layout; maxWidth is 800px
    (card as unknown as { _measure(): void })._measure(); // as a resize does
    await card.updateComplete;
    expect(card.shadowRoot!.querySelector('.enlarge')).toBeNull();
  });

  it('offers no enlarged view for a diagram shown at its natural size', async () => {
    render.mockResolvedValueOnce({ svg: '<svg><g class="node"></g></svg>' }); // no viewBox, so no maxWidth
    const card = await mount();
    expect(card.shadowRoot!.querySelector('.enlarge')).toBeNull();
  });
});

describe('zoom math', () => {
  it('keeps the point under the pointer where it is', () => {
    const view = zoomAt({ k: 1, x: 0, y: 0 }, 2, 100, 50, 4);
    expect(view).toEqual({ k: 2, x: -100, y: -50 });
    // The content point under (100, 50) was (100, 50) before and is still there after.
    expect([(100 - view.x) / view.k, (50 - view.y) / view.k]).toEqual([100, 50]);
  });

  it('stops at the fitted size and at the maximum', () => {
    expect(zoomAt({ k: 1, x: 0, y: 0 }, 0.5, 10, 10, 4).k).toBe(1);
    const view = zoomAt({ k: 3, x: -30, y: -30 }, 2, 0, 0, 4);
    expect(view).toEqual({ k: 4, x: -40, y: -40 }); // only the 4/3 that is left, still around (0, 0)
  });

  it('keeps the content covering its box', () => {
    expect(clampView({ k: 2, x: 50, y: -500 }, 300, 200, 4)).toEqual({ k: 2, x: 0, y: -200 });
    expect(clampView({ k: 0.5, x: -10, y: 10 }, 300, 200, 4)).toEqual({ k: 1, x: 0, y: 0 });
  });
});
