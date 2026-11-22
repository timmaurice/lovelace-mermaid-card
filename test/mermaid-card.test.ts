import { describe, expect, it, vi } from 'vitest';
import { bindNodes, stateColor } from '../src/entities';
import type { HassEntity, HomeAssistant } from '../src/types';

const render = vi.fn(async () => ({
  svg: '<svg><g class="node" id="mermaid-card-1-flowchart-A-0"><rect></rect></g><g class="node" id="mermaid-card-1-flowchart-B-0"><rect></rect></g></svg>',
}));
vi.mock('../src/mermaid', () => ({
  loadMermaid: async () => ({ initialize: vi.fn(), render }),
  listNodes: async () => [
    { id: 'A', label: 'A – Heat pump' },
    { id: 'B', label: 'B – Boiler' },
  ],
}));

const { MermaidCard, applyDirection, sizeDiagram } = await import('../src/mermaid-card');
const { MermaidCardEditor } = await import('../src/editor');
const { localize } = await import('../src/localize');

const entity = (entity_id: string, state: string): HassEntity => ({ entity_id, state, attributes: {} });

function makeHass(states: Record<string, HassEntity>, subscribeMessage = vi.fn()): HomeAssistant {
  return { states, themes: { darkMode: false }, connection: { subscribeMessage } } as HomeAssistant;
}

describe('stateColor', () => {
  it('maps states to Home Assistant state colours', () => {
    expect(stateColor(entity('light.a', 'on'))).toContain('--state-light-active-color');
    expect(stateColor(entity('light.a', 'off'))).toContain('--state-light-inactive-color');
    expect(stateColor(entity('light.a', 'unavailable'))).toContain('--state-unavailable-color');
    expect(stateColor(undefined)).toContain('--state-unavailable-color');
    expect(stateColor(entity('sensor.t', '21.5'))).toBeUndefined();
  });
});

describe('bindNodes', () => {
  it('colours bound nodes, leaves others alone and opens more-info on click and Enter', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<svg><g class="node" id="mermaid-card-1-flowchart-A-0"><rect></rect></g><g class="node" id="mermaid-card-1-flowchart-B-0"><rect></rect></g></svg>';
    const onTap = vi.fn();
    bindNodes(root, { A: 'light.a' }, { 'light.a': entity('light.a', 'on') }, onTap);

    const [a, b] = root.querySelectorAll<SVGGElement>('.node');
    expect(a.querySelector('rect')!.style.getPropertyValue('fill')).toContain('--state-light-active-color');
    expect(a.querySelector('rect')!.style.getPropertyValue('stroke')).toContain('--state-light-active-color');
    expect(b.querySelector('rect')!.style.getPropertyValue('fill')).toBe('');
    a.dispatchEvent(new MouseEvent('click'));
    a.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(onTap).toHaveBeenCalledTimes(2);
    expect(onTap).toHaveBeenCalledWith('light.a');
  });
});

describe('MermaidCard', () => {
  it('takes the whole section by default', () => {
    expect(new MermaidCard().getGridOptions()).toMatchObject({ columns: 'full', rows: 'auto' });
  });

  it('rejects a config without content', () => {
    expect(() => new MermaidCard().setConfig({ type: 'custom:mermaid-card' } as never)).toThrow(/content/);
  });

  it('renders plain content without a template subscription and binds nodes', async () => {
    const subscribe = vi.fn();
    const card = new MermaidCard();
    card.setConfig({ type: 'custom:mermaid-card', content: 'flowchart LR\n A --> B', entities: { A: 'light.a' } });
    card.hass = makeHass({ 'light.a': entity('light.a', 'off') }, subscribe);
    document.body.append(card);
    await vi.waitFor(() => expect(card.shadowRoot!.querySelector('.node rect')).not.toBeNull());

    expect(subscribe).not.toHaveBeenCalled();
    expect(render).toHaveBeenLastCalledWith(expect.any(String), 'flowchart LR\n A --> B');
    const rect = () => card.shadowRoot!.querySelector<SVGRectElement>('[id$="-flowchart-A-0"] rect')!;
    expect(rect().style.getPropertyValue('fill')).toContain('inactive');

    // A state change recolours without rendering the diagram again.
    const renders = render.mock.calls.length;
    card.hass = makeHass({ 'light.a': entity('light.a', 'on') }, subscribe);
    await card.updateComplete;
    expect(rect().style.getPropertyValue('fill')).toContain('active-color');
    expect(rect().style.getPropertyValue('fill')).not.toContain('inactive');
    expect(render.mock.calls.length).toBe(renders);
    card.remove();
  });

  it('draws the diagram again in the colours of a new theme', async () => {
    const card = new MermaidCard();
    card.setConfig({ type: 'custom:mermaid-card', content: 'flowchart LR\n A --> B' });
    card.hass = makeHass({});
    document.body.append(card);
    await vi.waitFor(() => expect(card.shadowRoot!.querySelector('svg')).not.toBeNull());
    const renders = render.mock.calls.length;
    card.hass = { ...makeHass({}), themes: { darkMode: false, theme: 'nord' } };
    await vi.waitFor(() => expect(render.mock.calls.length).toBe(renders + 1));
    card.remove();
  });

  it('adds the header from the options when the content has none', async () => {
    const card = new MermaidCard();
    card.setConfig({ type: 'custom:mermaid-card', content: '  A --> B', direction: 'TB' });
    card.hass = makeHass({});
    document.body.append(card);
    await vi.waitFor(() => expect(render).toHaveBeenLastCalledWith(expect.any(String), 'flowchart TB\n  A --> B'));
    card.remove();
  });

  it('gives a Gantt chart the card width in the diagram itself, not in the shared config', async () => {
    const card = new MermaidCard();
    card.setConfig({
      type: 'custom:mermaid-card',
      content: '  section A\n  Wash :w, 08:00, 90m',
      diagram_type: 'gantt',
    });
    card.hass = makeHass({});
    document.body.append(card);
    await vi.waitFor(() =>
      expect(render).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.stringMatching(/^gantt\n[\s\S]*%%\{init: \{"gantt":\{"useWidth":\d+/),
      ),
    );
    card.remove();
  });

  it('renders templated content through render_template and unsubscribes on removal', async () => {
    const unsubscribe = vi.fn(async () => undefined);
    let push: (message: unknown) => void = () => undefined;
    const subscribe = vi.fn(async (callback: (message: unknown) => void) => {
      push = callback;
      return unsubscribe;
    });
    const card = new MermaidCard();
    card.setConfig({ type: 'custom:mermaid-card', content: "flowchart LR\n A[{{ states('sensor.t') }}]" });
    card.hass = makeHass({}, subscribe);
    document.body.append(card);
    await card.updateComplete;

    expect(subscribe).toHaveBeenCalledWith(expect.any(Function), {
      type: 'render_template',
      template: "flowchart LR\n A[{{ states('sensor.t') }}]",
      report_errors: true,
    });
    push({ result: 'flowchart LR\n A[21.5]' });
    await vi.waitFor(() => expect(render).toHaveBeenLastCalledWith(expect.any(String), 'flowchart LR\n A[21.5]'));

    push({ error: 'UndefinedError', level: 'ERROR' });
    await card.updateComplete;
    expect(card.shadowRoot!.querySelector('ha-alert')?.textContent).toContain('UndefinedError');

    card.remove();
    await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalled());
  });
});

describe('applyDirection', () => {
  it('overrides, adds or keeps the flowchart direction', () => {
    expect(applyDirection('flowchart LR\n  A --> B', 'TD')).toBe('flowchart TD\n  A --> B');
    expect(applyDirection('graph LR;\n  A --> B', 'TD')).toBe('graph TD;\n  A --> B');
    expect(applyDirection('---\ntitle: x\n---\nflowchart\n  A --> B', 'TB')).toBe(
      '---\ntitle: x\n---\nflowchart TB\n  A --> B',
    );
    expect(applyDirection('flowchart LR\n  A --> B', undefined)).toBe('flowchart LR\n  A --> B');
    expect(applyDirection('sequenceDiagram\n  A->>B: hi', 'TD')).toBe('sequenceDiagram\n  A->>B: hi');
  });

  it('rejects an unknown direction', () => {
    expect(() =>
      new MermaidCard().setConfig({ type: 'custom:mermaid-card', content: 'flowchart LR', direction: 'up' as never }),
    ).toThrow(/direction/);
  });
});

describe('sizeDiagram', () => {
  const svgOf = (viewBox: string) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', viewBox);
    return svg;
  };

  it('fits to the card down to three quarters of the natural width', () => {
    const svg = svgOf('-8 -8 800 200');
    sizeDiagram(svg);
    expect([svg.style.maxWidth, svg.style.minWidth]).toEqual(['800px', '600px']);
    sizeDiagram(null); // no SVG, e.g. an empty render: nothing to do
  });

  it('scales both bounds with the scale option', () => {
    const svg = svgOf('0 0 800 200');
    sizeDiagram(svg, 150);
    expect([svg.style.maxWidth, svg.style.minWidth]).toEqual(['1200px', '900px']);
    sizeDiagram(svg, 50);
    expect([svg.style.maxWidth, svg.style.minWidth]).toEqual(['400px', '300px']);
  });

  it('rejects a scale that is not a positive number', () => {
    expect(() =>
      new MermaidCard().setConfig({ type: 'custom:mermaid-card', content: 'flowchart LR', scale: '150%' as never }),
    ).toThrow(/scale/);
  });
});

describe('MermaidCardEditor', () => {
  type Rows = { node: string; entity: string }[];
  const internals = (editor: InstanceType<typeof MermaidCardEditor>) =>
    editor as unknown as { _rows: Rows; _nodes: unknown[]; _rowsChanged(rows: Rows): void };

  it('keeps a half-filled row while writing only complete bindings to the config', () => {
    const editor = new MermaidCardEditor();
    const emitted: { entities?: Record<string, string> }[] = [];
    editor.addEventListener('config-changed', (event) => emitted.push((event as CustomEvent).detail.config));
    editor.setConfig({ type: 'custom:mermaid-card', content: 'flowchart LR\n A --> B', entities: { A: 'light.a' } });
    expect(internals(editor)._rows).toEqual([{ node: 'A', entity: 'light.a' }]);

    internals(editor)._rowsChanged([...internals(editor)._rows, { node: 'B', entity: '' }]);
    expect(emitted.at(-1)!.entities).toEqual({ A: 'light.a' });
    editor.setConfig(emitted.at(-1) as never); // Home Assistant echoes the config back
    expect(internals(editor)._rows).toHaveLength(2);

    internals(editor)._rowsChanged([
      { node: 'A', entity: 'light.a' },
      { node: 'B', entity: 'switch.b' },
    ]);
    expect(emitted.at(-1)!.entities).toEqual({ A: 'light.a', B: 'switch.b' });
    internals(editor)._rowsChanged([]);
    expect(emitted.at(-1)!.entities).toBeUndefined();
  });

  it('moves a header from the content into the options, and drops defaults', () => {
    const editor = new MermaidCardEditor();
    const emitted: Record<string, unknown>[] = [];
    editor.addEventListener('config-changed', (event) => emitted.push((event as CustomEvent).detail.config));
    editor.setConfig({ type: 'custom:mermaid-card', content: 'A --> B' });
    const change = (value: Record<string, unknown>) =>
      (editor as unknown as { _formChanged(event: CustomEvent): void })._formChanged(
        new CustomEvent('value-changed', { detail: { value: { content: 'A --> B', scale: 100, ...value } } }),
      );

    change({ content: 'stateDiagram-v2\n  A --> B', diagram_type: 'flowchart' }); // pasted with a header
    expect(emitted.at(-1)).toEqual({
      type: 'custom:mermaid-card',
      content: '  A --> B',
      diagram_type: 'stateDiagram-v2',
    });

    change({ content: 'flowchart LR\n  A --> B', diagram_type: 'pie' });
    expect(emitted.at(-1)).toEqual({ type: 'custom:mermaid-card', content: '  A --> B', direction: 'LR' });

    change({ content: 'A --> B', direction: 'TB' }); // top to bottom is the default
    expect(emitted.at(-1)).toEqual({ type: 'custom:mermaid-card', content: 'A --> B' });

    change({ diagram_type: 'sequenceDiagram', direction: 'LR' }); // a direction means nothing there
    expect(emitted.at(-1)).toEqual({
      type: 'custom:mermaid-card',
      content: 'A --> B',
      diagram_type: 'sequenceDiagram',
    });
  });

  it('swaps in the example of a new type, but never over the user’s own content', async () => {
    const { EXAMPLES } = await import('../src/header');
    const editor = new MermaidCardEditor();
    const emitted: { content?: string }[] = [];
    editor.addEventListener('config-changed', (event) => emitted.push((event as CustomEvent).detail.config));
    const change = (value: Record<string, unknown>) =>
      (editor as unknown as { _formChanged(event: CustomEvent): void })._formChanged(
        new CustomEvent('value-changed', { detail: { value: { scale: 100, ...value } } }),
      );

    editor.setConfig({ type: 'custom:mermaid-card', content: EXAMPLES.flowchart });
    change({ content: EXAMPLES.flowchart, diagram_type: 'pie' });
    expect(emitted.at(-1)!.content).toBe(EXAMPLES.pie);

    editor.setConfig({ type: 'custom:mermaid-card', content: '', diagram_type: 'pie' });
    change({ content: '', diagram_type: 'gantt' });
    expect(emitted.at(-1)!.content).toBe(EXAMPLES.gantt);

    editor.setConfig({ type: 'custom:mermaid-card', content: '  A --> B' });
    change({ content: '  A --> B', diagram_type: 'pie' });
    expect(emitted.at(-1)!.content).toBe('  A --> B');
  });

  it('offers the diagram nodes once the content was parsed', async () => {
    vi.useFakeTimers();
    const editor = new MermaidCardEditor();
    editor.setConfig({ type: 'custom:mermaid-card', content: 'flowchart LR\n A --> B' });
    await vi.advanceTimersByTimeAsync(500);
    vi.useRealTimers();
    expect(internals(editor)._nodes).toEqual([
      { id: 'A', label: 'A – Heat pump' },
      { id: 'B', label: 'B – Boiler' },
    ]);
  });
});

describe('localize', () => {
  it('uses the user language, then English, then the key', () => {
    expect(localize({ language: 'de' }, 'editor.bindings')).toBe('Gebundene Knoten');
    expect(localize({ language: 'fr' }, 'editor.bindings')).toBe('Bound nodes');
    expect(localize({ language: 'de' }, 'editor.direction_options.LR')).toBe('Von links nach rechts');
    expect(localize(undefined, 'editor.nope')).toBe('editor.nope');
  });
});

describe('diagram header', async () => {
  const { diagramType, stripHeader, withHeader } = await import('../src/header');

  it('reads a header behind front matter and comments, and nothing else', () => {
    expect(diagramType('flowchart LR\n  A --> B')).toBe('flowchart');
    expect(diagramType('graph TD;\n  A --> B')).toBe('flowchart');
    expect(diagramType('---\ntitle: x\n---\n%% note\nstateDiagram\n  [*] --> A')).toBe('stateDiagram-v2');
    expect(diagramType('A --> B')).toBeUndefined(); // a node line, not a header
    expect(diagramType('')).toBeUndefined();
  });

  it('takes the header out, keeping front matter', () => {
    expect(stripHeader('flowchart LR\n  A --> B')).toEqual({
      content: '  A --> B',
      type: 'flowchart',
      direction: 'LR',
    });
    expect(stripHeader('---\ntitle: x\n---\npie\n  "a": 1')).toEqual({
      content: '---\ntitle: x\n---\n  "a": 1',
      type: 'pie',
      direction: undefined,
    });
    expect(stripHeader('A --> B')).toEqual({ content: 'A --> B', type: undefined, direction: undefined });
  });

  it('builds the header from the options unless the content has its own', () => {
    expect(withHeader('  A --> B')).toBe('flowchart\n  A --> B');
    expect(withHeader('  A --> B', 'flowchart', 'TB')).toBe('flowchart TB\n  A --> B');
    expect(withHeader('  A->>B: hi', 'sequenceDiagram', 'TB')).toBe('sequenceDiagram\n  A->>B: hi');
    expect(withHeader('---\ntitle: x\n---\n  "a": 1', 'pie')).toBe('---\ntitle: x\n---\npie\n  "a": 1');
    expect(withHeader('graph LR\n  A --> B', 'pie')).toBe('graph LR\n  A --> B');
  });
});
