import { describe, expect, it, vi } from 'vitest';
import type { HassEntity, HomeAssistant } from '../src/types';

vi.mock('../src/mermaid', () => ({
  loadMermaid: async () => ({ initialize: vi.fn(), render: vi.fn() }),
  listNodes: async () => [],
}));

const { MermaidCardEditor, suggestEntity } = await import('../src/editor');

const entity = (entity_id: string, friendly_name?: string): HassEntity => ({
  entity_id,
  state: 'on',
  attributes: { friendly_name },
});
const states = (...entities: HassEntity[]) => Object.fromEntries(entities.map((e) => [e.entity_id, e]));

describe('suggestEntity', () => {
  it('matches the friendly name to the node text, trimmed and ignoring case', () => {
    expect(suggestEntity('A', ' heat PUMP ', states(entity('switch.x', 'Heat pump'), entity('light.y', 'Lamp')))).toBe(
      'switch.x',
    );
  });

  it('falls back to the object id matching the lowercased node id', () => {
    expect(suggestEntity('Boiler', 'Something', states(entity('switch.boiler'), entity('light.boiler_2')))).toBe(
      'switch.boiler',
    );
    expect(suggestEntity('Boiler', undefined, states(entity('switch.boiler')))).toBe('switch.boiler');
  });

  it('suggests nothing when several entities match, or none', () => {
    expect(suggestEntity('A', 'Lamp', states(entity('light.a', 'Lamp'), entity('light.b', 'Lamp')))).toBe('');
    expect(suggestEntity('pump', '', states(entity('switch.pump'), entity('sensor.pump')))).toBe('');
    expect(suggestEntity('X', 'Nothing', states(entity('light.a', 'Lamp')))).toBe('');
  });
});

describe('MermaidCardEditor entity suggestion', () => {
  type Binding = { node: string; entity: string };
  const make = () => {
    const editor = new MermaidCardEditor();
    editor.hass = { states: states(entity('switch.pump', 'Heat pump')) } as unknown as HomeAssistant;
    const internals = editor as unknown as {
      _nodes: { id: string; label: string; text: string }[];
      _suggest(old: Binding, row: Binding): Binding;
    };
    internals._nodes = [{ id: 'A', label: 'A – Heat pump', text: 'Heat pump' }];
    return internals;
  };

  it('fills in the entity when a node is picked for an empty row', () => {
    expect(make()._suggest({ node: '', entity: '' }, { node: 'A', entity: '' })).toEqual({
      node: 'A',
      entity: 'switch.pump',
    });
  });

  it('never overwrites an entity, nor refills one the user cleared', () => {
    const editor = make();
    expect(editor._suggest({ node: '', entity: 'light.x' }, { node: 'A', entity: 'light.x' }).entity).toBe('light.x');
    expect(editor._suggest({ node: 'A', entity: 'switch.pump' }, { node: 'A', entity: '' }).entity).toBe('');
  });
});
