import { describe, expect, it, vi } from 'vitest';
import type { HomeAssistant } from '../src/types';

vi.mock('../src/mermaid', () => ({
  loadMermaid: async () => ({ initialize: vi.fn(), render: vi.fn() }),
  listNodes: async () => [],
}));

const { MermaidCardEditor } = await import('../src/editor');

describe('MermaidCardEditor bindings', () => {
  it('warns about a binding whose node is gone, once the diagram ids are known', async () => {
    const editor = new MermaidCardEditor();
    const internals = editor as unknown as { _nodes: { id: string; label: string }[] };
    editor.hass = { states: {}, connection: { subscribeMessage: vi.fn() } } as unknown as HomeAssistant;
    editor.setConfig({ type: 'custom:mermaid-card', content: 'A --> B', entities: { A: 'light.a', Gone: 'light.b' } });
    document.body.append(editor);
    await editor.updateComplete;
    const warnings = () => [...editor.shadowRoot!.querySelectorAll('.stale')].map((p) => p.textContent);

    expect(warnings()).toEqual([]); // no ids yet: nothing can be judged

    internals._nodes = [{ id: 'A', label: 'A' }];
    await editor.updateComplete;
    expect(warnings()).toEqual(['This node is not in the diagram.']);
    expect(editor.shadowRoot!.querySelectorAll('.row')[1].nextElementSibling?.className).toBe('stale');
    editor.remove();
  });
});
