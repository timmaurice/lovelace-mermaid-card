import { describe, expect, it, vi } from 'vitest';
import type { HomeAssistant } from '../src/types';

vi.mock('../src/mermaid', () => ({
  loadMermaid: async () => ({ initialize: vi.fn(), render: async () => ({ svg: '<svg></svg>' }) }),
  listNodes: async () => ({ nodes: [] }),
}));

const { MermaidCard } = await import('../src/mermaid-card');

describe('getCardSize', () => {
  it('is 4 before the first render, then the diagram height in 50 px units plus the header', async () => {
    const card = new MermaidCard();
    card.setConfig({ type: 'custom:mermaid-card', content: 'flowchart LR\n A --> B', title: 'Heating' });
    expect(card.getCardSize()).toBe(4);

    card.hass = {
      states: {},
      themes: { darkMode: false },
      connection: { subscribeMessage: vi.fn() },
    } as never as HomeAssistant;
    document.body.append(card);
    await vi.waitFor(() => expect(card.shadowRoot!.querySelector('svg')).not.toBeNull());
    // jsdom has no layout.
    card.shadowRoot!.querySelector('svg')!.getBoundingClientRect = () => ({ height: 120 }) as DOMRect;
    expect(card.getCardSize()).toBe(3 + 1);
    card.remove();
  });
});
