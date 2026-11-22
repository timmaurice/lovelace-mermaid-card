import { describe, expect, it, vi } from 'vitest';
import type { HomeAssistant, MermaidCardConfig } from '../src/types';

vi.mock('../src/mermaid', () => ({
  loadMermaid: async () => ({ initialize: vi.fn(), render: vi.fn() }),
  listNodes: async () => ({ nodes: [] }),
}));

const { MermaidCardEditor } = await import('../src/editor');

type Internals = { _nodes: { id: string; label: string }[]; _addNode(entityId: string): void };

function setup(content: string, entities?: Record<string, string>) {
  const editor = new MermaidCardEditor();
  editor.hass = {
    states: {
      'sensor.outdoor_temp': {
        entity_id: 'sensor.outdoor_temp',
        state: '4',
        attributes: { friendly_name: 'Outdoor "north"' },
      },
      'switch.end': { entity_id: 'switch.end', state: 'on', attributes: { friendly_name: 'Pump {{ 1 }}' } },
    },
  } as unknown as HomeAssistant;
  const emitted: MermaidCardConfig[] = [];
  editor.addEventListener('config-changed', (event) => emitted.push((event as CustomEvent).detail.config));
  editor.setConfig({ type: 'custom:mermaid-card', content, entities });
  return { internals: editor as unknown as Internals, emitted };
}

describe('MermaidCardEditor: add an entity as a node', () => {
  it('appends a node line and its binding in one change', () => {
    const { internals, emitted } = setup('  A --> B', { A: 'light.a' });
    internals._addNode('sensor.outdoor_temp');
    expect(emitted).toHaveLength(1);
    expect(emitted[0].content).toBe(
      `  A --> B\n  outdoor_temp["Outdoor #quot;north#quot;<br>{{ states('sensor.outdoor_temp', with_unit=True) }}"]`,
    );
    expect(emitted[0].entities).toEqual({ A: 'light.a', outdoor_temp: 'sensor.outdoor_temp' });
  });

  it('works on empty content and falls back to the entity id as name', () => {
    const { internals, emitted } = setup('');
    internals._addNode('light.unknown');
    expect(emitted[0].content).toBe(`  unknown["light.unknown<br>{{ states('light.unknown', with_unit=True) }}"]`);
  });

  it('does not add a blank line after content ending with a newline', () => {
    const { internals, emitted } = setup('  A --> B\n');
    internals._addNode('light.x');
    expect(emitted[0].content).toMatch(/^ {2}A --> B\n {2}x\["/);
  });

  it('makes the id unique against diagram nodes and bindings', () => {
    const { internals, emitted } = setup('  outdoor_temp --> B', { outdoor_temp_2: 'light.a' });
    internals._nodes = [{ id: 'outdoor_temp', label: 'outdoor_temp' }];
    internals._addNode('sensor.outdoor_temp');
    expect(emitted[0].entities).toMatchObject({ outdoor_temp_3: 'sensor.outdoor_temp' });
    expect(emitted[0].content).toContain('\n  outdoor_temp_3["');
  });

  it('avoids the reserved id end and keeps template braces out of the name', () => {
    const { internals, emitted } = setup('');
    internals._addNode('switch.end');
    expect(emitted[0].content).toBe(`  end_2["Pump #123;#123; 1 }}<br>{{ states('switch.end', with_unit=True) }}"]`);
  });
});
