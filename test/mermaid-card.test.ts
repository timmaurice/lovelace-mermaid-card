import { describe, expect, it, vi } from 'vitest';
import { bindNodes, edgeDuration, isActive, stateColor } from '../src/entities';
import { TEMPLATE, type HassEntity, type HomeAssistant, type MermaidCardConfig } from '../src/types';

const render = vi.fn(async () => ({
  svg: '<svg><g class="node" id="mermaid-card-1-flowchart-A-0"><rect></rect></g><g class="node" id="mermaid-card-1-flowchart-B-0"><rect></rect></g></svg>',
}));
const initialize = vi.fn();
vi.mock('../src/mermaid', () => ({
  loadMermaid: async () => ({ initialize, render }),
  listNodes: async () => ({
    nodes: [
      { id: 'A', label: 'A – Heat pump' },
      { id: 'B', label: 'B – Boiler' },
    ],
  }),
}));

const { MermaidCard, applyDirection, cropDiagram, sizeDiagram } = await import('../src/mermaid-card');
const { MermaidCardEditor, suggestEntity } = await import('../src/editor');
const { localize } = await import('../src/localize');

const entity = (entity_id: string, state: string): HassEntity => ({ entity_id, state, attributes: {} });

function makeHass(states: Record<string, HassEntity>, subscribeMessage = vi.fn()): HomeAssistant {
  return { states, themes: { darkMode: false }, connection: { subscribeMessage } } as unknown as HomeAssistant;
}

describe('stateColor', () => {
  it('maps states to Home Assistant state colours', () => {
    expect(stateColor(entity('light.a', 'on'))).toContain('--state-light-active-color');
    expect(stateColor(entity('light.a', 'off'))).toContain('--state-light-inactive-color');
    expect(stateColor(entity('light.a', 'unavailable'))).toContain('--state-unavailable-color');
    expect(stateColor(undefined)).toContain('--state-unavailable-color');
    expect(stateColor(entity('sensor.t', '21.5'))).toBeUndefined();
  });

  it('counts on, heating and non-zero numbers as active', () => {
    expect(isActive(entity('light.a', 'on'))).toBe(true);
    expect(isActive(entity('climate.a', 'heat'))).toBe(true);
    expect(isActive(entity('sensor.p', '-120'))).toBe(true);
    expect(isActive(entity('sensor.p', '0'))).toBe(false);
    expect(isActive(entity('light.a', 'off'))).toBe(false);
    expect(isActive(entity('light.a', 'unavailable'))).toBe(false);
    expect(isActive(undefined)).toBe(false);
  });

  it('with active_when, counts only the given states as active, and unavailable as unavailable', () => {
    const vacuum = (state: string) => entity('input_select.robot_vacuum', state);
    const active = '--state-input_select-active-color';
    const inactive = '--state-input_select-inactive-color';
    expect(stateColor(vacuum('Cleaning'), 'Cleaning')).toContain(active);
    expect(stateColor(vacuum('Docked'), 'Cleaning')).toContain(inactive);
    expect(stateColor(vacuum('Docked'), ['Cleaning', 'Docked'])).toContain(active);
    expect(stateColor(vacuum('unavailable'), 'Cleaning')).toContain('--state-unavailable-color');
    expect(stateColor(entity('sensor.phase', '3'), '3')).toContain('--state-sensor-active-color');
    expect(isActive(vacuum('Cleaning'), ['Cleaning'])).toBe(true);
    expect(isActive(vacuum('Docked'), 'Cleaning')).toBe(false);
    expect(isActive(entity('switch.a', 'off'), 'off')).toBe(true);
    expect(isActive(vacuum('unknown'), 'unknown')).toBe(false);
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
    expect(onTap).toHaveBeenCalledWith({ entity: 'light.a' }, 'tap');
  });

  it('lights only the node whose active_when matches, when several share one entity', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<svg><g class="node" id="mermaid-card-1-state-Cleaning-0"><rect></rect></g>' +
      '<g class="node" id="mermaid-card-1-state-Docked-0"><rect></rect></g>' +
      '<path data-id="e1"></path></svg>';
    const vacuum = 'input_select.robot_vacuum';
    bindNodes(
      root,
      {
        Cleaning: { entity: vacuum, active_when: 'Cleaning' },
        Docked: { entity: vacuum, active_when: ['Docked', 'Charging'] },
        e1: { entity: vacuum, active_when: 'Cleaning' },
      },
      { [vacuum]: entity(vacuum, 'Charging') },
      vi.fn(),
    );
    const [cleaning, docked] = root.querySelectorAll('rect');
    expect(cleaning.style.getPropertyValue('stroke')).toContain('--state-input_select-inactive-color');
    expect(docked.style.getPropertyValue('stroke')).toContain('--state-input_select-active-color');
    expect(root.querySelector('path')!.classList.contains('edge-animation-fast')).toBe(false);
  });

  it('binds an icon shape and draws its icon in the state colour', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<svg><g class="icon-shape default" id="mermaid-card-1-flowchart-HP-0"><g class="label"><rect></rect></g><g style="color: #009ac7"><path></path></g></g></svg>';
    const onAction = vi.fn();
    bindNodes(root, { HP: 'switch.pump' }, { 'switch.pump': entity('switch.pump', 'on') }, onAction);
    const node = root.querySelector<SVGGElement>('.icon-shape')!;
    const icon = node.querySelector<SVGGElement>('g[style]')!;
    expect(icon.style.color).toContain('--state-switch-active-color');
    expect(node.querySelector('rect')!.getAttribute('style')).toBeNull(); // the label box keeps its look
    node.dispatchEvent(new MouseEvent('click'));
    expect(onAction).toHaveBeenCalledWith({ entity: 'switch.pump' }, 'tap');
    bindNodes(root, { HP: 'switch.pump' }, { 'switch.pump': entity('switch.pump', 'unknown_state_x') }, onAction);
    expect(icon.style.color).toContain('--state-switch-active-color'); // any other text counts as active
    bindNodes(root, { HP: 'switch.pump' }, { 'switch.pump': entity('switch.pump', '21.5') }, onAction);
    expect(icon.style.color).toBe('rgb(0, 154, 199)'); // a number keeps the diagram's own colour
  });

  it('runs the hold action on a long press instead of the tap', () => {
    vi.useFakeTimers();
    const root = document.createElement('div');
    root.innerHTML = '<svg><g class="node" id="mermaid-card-1-flowchart-A-0"><rect></rect></g></svg>';
    const onAction = vi.fn();
    const binding = { entity: 'light.a', hold_action: { action: 'toggle' } };
    bindNodes(root, { A: binding }, {}, onAction);
    const node = root.querySelector<SVGGElement>('.node')!;
    node.dispatchEvent(new Event('pointerdown'));
    vi.advanceTimersByTime(600);
    node.dispatchEvent(new Event('pointerup'));
    node.dispatchEvent(new MouseEvent('click'));
    vi.useRealTimers();
    expect(onAction.mock.calls).toEqual([[binding, 'hold']]);
  });

  it('binds a Gantt task by its id and a mind map node by its label, not by its position', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<svg id="r1"><rect class="task" id="r1-wash"></rect>' +
      '<g class="node mindmap-node" id="r1-node_1"><rect></rect><foreignObject><div>Lamp<br>hall</div></foreignObject></g></svg>';
    const states = { 'light.a': entity('light.a', 'on') };
    const mindmapNode = root.querySelector<SVGElement>('.mindmap-node')!;
    bindNodes(root, { node_1: 'light.a' }, states, vi.fn());
    expect(mindmapNode.getAttribute('role')).toBeNull();
    bindNodes(root, { wash: 'light.a', 'Lamp hall': 'light.a' }, states, vi.fn());
    expect(root.querySelector<SVGElement>('rect.task')!.style.getPropertyValue('fill')).toContain('--state-light');
    expect(mindmapNode.querySelector('rect')!.style.getPropertyValue('fill')).toContain('--state-light');
    expect(mindmapNode.getAttribute('role')).toBe('button');
  });

  it('pairs pie slices with their legend entry, past entries Mermaid drew no slice for', () => {
    const root = document.createElement('div');
    const legend = (label: string, color: string) =>
      `<g class="legend"><rect style="fill: ${color}"></rect><text>${label}</text></g>`;
    root.innerHTML =
      '<svg><path class="pieCircle" fill="#ff0000"></path><path class="pieCircle" fill="#0000ff"></path>' +
      legend('Washer [30]', 'rgb(255, 0, 0)') +
      legend('Tiny [0.1]', 'rgb(0, 255, 0)') +
      legend('Dryer [70]', 'rgb(0, 0, 255)') +
      '</svg>';
    const onAction = vi.fn();
    bindNodes(root, { Dryer: 'light.a', Tiny: 'light.b' }, {}, onAction);
    const [washer, dryer] = root.querySelectorAll<SVGElement>('.pieCircle');
    expect(washer.getAttribute('role')).toBeNull();
    dryer.dispatchEvent(new MouseEvent('click'));
    expect(onAction).toHaveBeenCalledWith({ entity: 'light.a' }, 'tap');
    expect(dryer.style.getPropertyValue('fill')).toBe(''); // a slice keeps its chart colour
    expect(root.querySelectorAll('.legend')[1].getAttribute('role')).toBe('button'); // Tiny: legend only
  });

  it('keeps the speed or classDef animation the diagram gives an edge, on only while active', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<svg><path data-id="slow" class="edge-animation-slow"></path>' +
      '<path data-id="own" style="animation: dash 25s linear infinite"></path></svg>';
    const [slow, own] = root.querySelectorAll<SVGPathElement>('path');
    const bind = (state: string) =>
      bindNodes(root, { slow: 'switch.p', own: 'switch.p' }, { 'switch.p': entity('switch.p', state) }, vi.fn());

    bind('off');
    expect(slow.getAttribute('class')).toBe('');
    expect(own.style.animation).toBe('none');
    bind('on');
    expect(slow.getAttribute('class')).toBe('edge-animation-slow');
    expect(own.style.animation).toMatch(/\bdash\b/); // the classDef's own animation again
  });

  it('starts a bound edge’s dashes where they can move, and puts it back when off', () => {
    const root = document.createElement('div');
    root.innerHTML = '<svg><path data-id="e1" style="stroke-dashoffset: 0"></path></svg>'; // as Mermaid draws it
    const edge = root.querySelector('path')!;
    bindNodes(root, { e1: 'switch.pump' }, { 'switch.pump': entity('switch.pump', 'on') }, vi.fn());
    expect(edge.style.strokeDashoffset).toBe('900px');
    bindNodes(root, { e1: 'switch.pump' }, { 'switch.pump': entity('switch.pump', 'off') }, vi.fn());
    expect(edge.style.strokeDashoffset).toBe('0');
  });

  it('maps a value to a duration by its square root, from slow near zero to fast at max', () => {
    expect(edgeDuration(0)).toBe(50);
    expect(edgeDuration(10000)).toBe(5);
    expect(edgeDuration(50000)).toBe(5); // past max stays at full speed
    expect(edgeDuration(-300)).toBe(edgeDuration(300));
    expect(edgeDuration(10)).toBeGreaterThan(edgeDuration(100));
    expect(edgeDuration(100)).toBeGreaterThan(edgeDuration(1000));
    expect(edgeDuration(3, 10)).toBeLessThan(edgeDuration(3)); // a kW sensor with max: 10
    // A washer at a fifth of the solar power visibly moves slower, about half as fast.
    expect(edgeDuration(650, 4000) / edgeDuration(3200, 4000)).toBeGreaterThan(1.8);
  });

  it('sets duration and direction inline for speed: auto, and only there', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<svg><path data-id="pv" style="stroke-dashoffset: 0"></path><path data-id="plain"></path>' +
      '<path data-id="own" style="animation: dash 25s linear infinite"></path></svg>';
    const [pv, plain, own] = root.querySelectorAll<SVGPathElement>('path');
    const bind = (state: string) =>
      bindNodes(
        root,
        { pv: { entity: 'sensor.grid', speed: 'auto', max: 5000 }, plain: 'sensor.grid', own: 'sensor.grid' },
        { 'sensor.grid': entity('sensor.grid', state) },
        vi.fn(),
      );

    bind('5000');
    expect(pv.style.animationDuration).toBe('5s');
    expect(pv.style.animationDirection).toBe('');
    expect(pv.classList.contains('edge-animation-fast')).toBe(true); // dash pattern and keyframes stay Mermaid's
    expect(plain.style.animationDuration).toBe('');
    expect(own.style.animation).toMatch(/\b25s\b/); // a classDef's own speed is untouched
    bind('-5000'); // export: the other way round
    expect(pv.style.animationDirection).toBe('reverse');
    bind('0');
    expect(pv.style.animationDuration).toBe('');
    expect(pv.style.animationDirection).toBe('');
    expect(pv.classList.contains('edge-animation-fast')).toBe(false);
  });

  it('animates a bound edge while its entity is active', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<svg><marker id="m"><path></path></marker><path data-id="e1" marker-end="url(#m)"></path><g data-id="e1"></g></svg>';
    const edge = root.querySelector<SVGPathElement>('path[data-id]')!;
    bindNodes(root, { e1: 'switch.pump' }, { 'switch.pump': entity('switch.pump', 'on') }, vi.fn());
    expect(edge.classList.contains('edge-animation-fast')).toBe(true);
    expect(edge.style.getPropertyValue('stroke')).toContain('--state-switch-active-color');
    // The arrowhead takes the colour too, from a copy: the shared marker stays as Mermaid drew it.
    const copy = root.querySelector<SVGMarkerElement>(`[id="${edge.getAttribute('marker-end')!.slice(5, -1)}"]`)!;
    expect(copy.id).not.toBe('m');
    expect(copy.querySelector('path')!.style.getPropertyValue('fill')).toContain('--state-switch-active-color');
    expect(root.querySelector('#m path')!.getAttribute('style')).toBeNull();
    bindNodes(root, { e1: 'switch.pump' }, { 'switch.pump': entity('switch.pump', 'off') }, vi.fn());
    expect(edge.classList.contains('edge-animation-fast')).toBe(false);
    expect(edge.style.getPropertyValue('stroke')).toBe('');
    expect(edge.getAttribute('marker-end')).toBe('url(#m)');
  });
});

describe('MermaidCard', () => {
  it('takes the whole section by default', () => {
    expect(new MermaidCard().getGridOptions()).toMatchObject({ columns: 'full', rows: 'auto' });
  });

  it('rejects a config without content', () => {
    expect(() => new MermaidCard().setConfig({ type: 'custom:mermaid-card' } as never)).toThrow(/content/);
  });

  it('accepts active_when as a state or a list of states, nothing else', () => {
    const config = (active_when: unknown) =>
      ({
        type: 'custom:mermaid-card',
        content: 'A',
        entities: { A: { entity: 'input_select.v', active_when } },
      }) as never;
    expect(() => new MermaidCard().setConfig(config('Cleaning'))).not.toThrow();
    expect(() => new MermaidCard().setConfig(config(['Cleaning', 'Docked']))).not.toThrow();
    expect(() => new MermaidCard().setConfig(config(3))).toThrow(/active_when/);
    expect(() => new MermaidCard().setConfig(config(['Cleaning', { state: 'x' }]))).toThrow(/active_when/);
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

  it('colours the mind map root, git branches and journey sections from the palette, not the near-black card colour', () => {
    const vars = (new MermaidCard() as unknown as { _themeVariables(): Record<string, string> })._themeVariables();
    expect([vars.git0, vars.gitBranchLabel0, vars.git7]).toEqual(['#2196f3', '#ffffff', '#3f51b5']); // jsdom: fallbacks
    expect(vars.fillType1).toBe('#ff6f22');
    expect([vars.pie9, vars.cScale11]).toEqual(['#2196f3', '#926bc7']); // past the palette, it starts over
    expect(vars.xyChart).toEqual({ plotColorPalette: expect.stringMatching(/^#2196f3,#ff6f22,/) });
  });

  it('tells Mermaid’s theme about dark mode, where it reads it', async () => {
    const card = new MermaidCard();
    card.setConfig({ type: 'custom:mermaid-card', content: 'flowchart LR\n A --> B' });
    card.hass = { ...makeHass({}), themes: { darkMode: true } };
    document.body.append(card);
    await vi.waitFor(() => expect(card.shadowRoot!.querySelector('svg')).not.toBeNull());
    expect(initialize.mock.lastCall![0]).toMatchObject({ themeVariables: { darkMode: true } });
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

  it('treats a closed Jinja comment as a template, but not a rhombus starting with #', () => {
    expect(TEMPLATE.test('A --> B\n{# heating loop #}')).toBe(true);
    expect(TEMPLATE.test('A{#1 choice} --> B')).toBe(false);
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

describe('cropDiagram', () => {
  const svgOf = (viewBox: string, box: { x: number; y: number; width: number; height: number } | Error) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', viewBox);
    svg.getBBox = () => {
      if (box instanceof Error) throw box;
      return box as DOMRect;
    };
    return svg;
  };

  it('crops empty space around the drawing, keeping a margin', () => {
    const svg = svgOf('0 -25 1128 540', { x: 13, y: -7, width: 847, height: 457 }); // a user journey
    cropDiagram(svg);
    expect(svg.getAttribute('viewBox')).toBe('5 -15 863 473');
    const pie = svgOf('0 0 571 450', { x: 39, y: 2, width: 483, height: 409 }); // close to the top edge
    cropDiagram(pie);
    expect(pie.getAttribute('viewBox')).toBe('31 0 499 419');
  });

  it('keeps the box when the drawing reaches past it, or cannot be measured', () => {
    const gantt = svgOf('0 0 468 184', { x: 0, y: 25, width: 1057, height: 134 });
    cropDiagram(gantt);
    expect(gantt.getAttribute('viewBox')).toBe('0 0 468 184');
    const hidden = svgOf('0 0 100 100', new Error('not shown')); // Firefox, for an SVG that is not shown
    cropDiagram(hidden);
    expect(hidden.getAttribute('viewBox')).toBe('0 0 100 100');
    cropDiagram(null);
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

  it('rejects a speed other than auto, and a max that is not a positive number', () => {
    const config = (binding: object) => ({
      type: 'custom:mermaid-card',
      content: 'A e1@--> B',
      entities: { e1: binding },
    });
    expect(() => new MermaidCard().setConfig(config({ entity: 'sensor.p', speed: 'fast' }) as never)).toThrow(/speed/);
    expect(() => new MermaidCard().setConfig(config({ entity: 'sensor.p', speed: 'auto', max: 0 }) as never)).toThrow(
      /max/,
    );
    new MermaidCard().setConfig(config({ entity: 'sensor.p', speed: 'auto', max: 5000 }) as never);
  });

  it('rejects a scale that is not a positive number', () => {
    expect(() =>
      new MermaidCard().setConfig({ type: 'custom:mermaid-card', content: 'flowchart LR', scale: '150%' as never }),
    ).toThrow(/scale/);
  });
});

describe('MermaidCardEditor', () => {
  type Rows = { node: string; entity: string; active_when?: string | string[] }[];
  const internals = (editor: InstanceType<typeof MermaidCardEditor>) =>
    editor as unknown as { _rows: Rows; _nodes: unknown[]; _rowsChanged(rows: Rows): void };

  it('unfolds a row added here and keeps the others folded, also after a removal', async () => {
    const editor = new MermaidCardEditor();
    editor.hass = makeHass({});
    editor.setConfig({ type: 'custom:mermaid-card', content: 'A --> B', entities: { A: 'light.a', B: 'light.b' } });
    document.body.append(editor);
    const internals = editor as unknown as { _addRow(): void; _removeRow(index: number): void };
    const expanded = async () => {
      await editor.updateComplete;
      return [...editor.shadowRoot!.querySelectorAll('ha-expansion-panel')].map(
        (panel) => (panel as unknown as { expanded: boolean }).expanded,
      );
    };
    expect(await expanded()).toEqual([false, false]);
    internals._addRow();
    expect(await expanded()).toEqual([false, false, true]);
    internals._removeRow(0);
    expect(await expanded()).toEqual([false, true]);
    editor.remove();
  });

  it('offers actions for a bound node, a speed for a bound edge', async () => {
    const editor = new MermaidCardEditor();
    editor.hass = makeHass({});
    editor.setConfig({
      type: 'custom:mermaid-card',
      content: 'A --> B',
      entities: { A: 'light.a', L_A_B_0: { entity: 'sensor.p', speed: 'auto' } },
    });
    (editor as unknown as { _nodes: unknown[] })._nodes = [
      { id: 'A', label: 'A', text: '' },
      { id: 'L_A_B_0', label: 'L_A_B_0 – A → B', text: '', edge: true },
    ];
    document.body.append(editor);
    await editor.updateComplete;
    const schemas = [...editor.shadowRoot!.querySelectorAll('ha-expansion-panel ha-form')].map((form) =>
      (form as unknown as { schema: { name: string }[] }).schema.map((item) => item.name),
    );
    expect(schemas).toEqual([
      ['', 'active_when', 'tap_action', 'hold_action'],
      ['', 'active_when', 'speed', 'max'], // max only once the speed follows the value
    ]);
    editor.remove();
  });

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

  it('keeps the actions of a binding, writing the long form only where there are some', () => {
    const editor = new MermaidCardEditor();
    const emitted: { entities?: Record<string, unknown> }[] = [];
    editor.addEventListener('config-changed', (event) => emitted.push((event as CustomEvent).detail.config));
    const entities = {
      A: { entity: 'light.a', hold_action: { action: 'toggle' } },
      B: 'switch.b',
      e1: { entity: 'sensor.p', speed: 'auto' as const, max: 5000 },
    };
    editor.setConfig({ type: 'custom:mermaid-card', content: 'A e1@--> B', entities });
    internals(editor)._rowsChanged(internals(editor)._rows);
    expect(emitted.at(-1)!.entities).toEqual(entities);
    // The dropdown's "as in the diagram" leaves only the entity, its max with the speed.
    internals(editor)._rowsChanged([{ node: 'e1', entity: 'sensor.p', speed: 'off', max: 5000 } as never]);
    expect(emitted.at(-1)!.entities).toEqual({ e1: 'sensor.p' });
  });

  it('keeps active_when, as a state or a list, and drops it when emptied', () => {
    const editor = new MermaidCardEditor();
    const emitted: { entities?: Record<string, unknown> }[] = [];
    editor.addEventListener('config-changed', (event) => emitted.push((event as CustomEvent).detail.config));
    const entities = {
      A: { entity: 'input_select.v', active_when: 'Cleaning' },
      B: { entity: 'input_select.v', active_when: ['Docked', 'Charging'] },
    };
    editor.setConfig({ type: 'custom:mermaid-card', content: 'A --> B', entities });
    internals(editor)._rowsChanged(internals(editor)._rows);
    expect(emitted.at(-1)!.entities).toEqual(entities);
    internals(editor)._rowsChanged([
      { node: 'A', entity: 'input_select.v', active_when: [] },
      { node: 'B', entity: 'input_select.v', active_when: '' },
    ]);
    expect(emitted.at(-1)!.entities).toEqual({ A: 'input_select.v', B: 'input_select.v' });
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

    change({ content: 'pie showData\n  "a": 1', diagram_type: 'flowchart' }); // more than the dropdown holds
    expect(emitted.at(-1)).toMatchObject({ content: 'pie showData\n  "a": 1', diagram_type: 'pie' });

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

  it('edits an automation card without content, and brings content back when the automation is cleared', async () => {
    const { EXAMPLES } = await import('../src/header');
    const editor = new MermaidCardEditor();
    editor.hass = makeHass({});
    const emitted: Record<string, unknown>[] = [];
    editor.addEventListener('config-changed', (event) => emitted.push((event as CustomEvent).detail.config));
    editor.setConfig({ type: 'custom:mermaid-card', automation: 'automation.hall' });
    document.body.append(editor);
    await editor.updateComplete;
    const form = editor.shadowRoot!.querySelector('ha-form') as unknown as { schema: { name: string }[] };
    expect(form.schema.map((field) => field.name)).toEqual(['title', 'automation', 'scale']);

    const change = (value: Record<string, unknown>) =>
      (editor as unknown as { _formChanged(event: CustomEvent): void })._formChanged(
        new CustomEvent('value-changed', {
          detail: { value: { content: '', diagram_type: 'flowchart', direction: 'TB', scale: 100, ...value } },
        }),
      );
    change({ automation: 'automation.hall', title: 'Hall' }); // the form hands back its hidden fields too
    expect(emitted.at(-1)).toEqual({ type: 'custom:mermaid-card', automation: 'automation.hall', title: 'Hall' });

    change({ automation: undefined, title: 'Hall' });
    expect(emitted.at(-1)).toEqual({ type: 'custom:mermaid-card', title: 'Hall', content: EXAMPLES.flowchart });
    editor.remove();
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

  it('leaves a header that says more than type and direction in the content', () => {
    expect(stripHeader('pie showData\n  "a": 1')).toEqual({
      content: 'pie showData\n  "a": 1',
      type: 'pie',
      direction: undefined,
    });
    expect(stripHeader('xychart-beta horizontal\n  bar [1]').content).toBe('xychart-beta horizontal\n  bar [1]');
    expect(stripHeader('graph TD;\n  A --> B').content).toBe('  A --> B'); // a direction and `;` are no more
  });

  it('builds the header from the options unless the content has its own', () => {
    expect(withHeader('  A --> B')).toBe('flowchart\n  A --> B');
    expect(withHeader('  A --> B', 'flowchart', 'TB')).toBe('flowchart TB\n  A --> B');
    expect(withHeader('  A->>B: hi', 'sequenceDiagram', 'TB')).toBe('sequenceDiagram\n  A->>B: hi');
    expect(withHeader('---\ntitle: x\n---\n  "a": 1', 'pie')).toBe('---\ntitle: x\n---\npie\n  "a": 1');
    expect(withHeader('graph LR\n  A --> B', 'pie')).toBe('graph LR\n  A --> B');
  });
});

describe('getCardSize', () => {
  it('is 4 before the first render, then the diagram height in 50 px units plus the header', async () => {
    const card = new MermaidCard();
    card.setConfig({ type: 'custom:mermaid-card', content: 'flowchart LR\n A --> B', title: 'Heating' });
    expect(card.getCardSize()).toBe(4);

    card.hass = makeHass({});
    document.body.append(card);
    await vi.waitFor(() => expect(card.shadowRoot!.querySelector('svg')).not.toBeNull());
    // jsdom has no layout.
    card.shadowRoot!.querySelector('svg')!.getBoundingClientRect = () => ({ height: 120 }) as DOMRect;
    expect(card.getCardSize()).toBe(3 + 1);
    card.remove();
  });
});

describe('MermaidCardEditor bindings', () => {
  it('warns about a binding whose node is gone, once the diagram ids are known', async () => {
    const editor = new MermaidCardEditor();
    const internals = editor as unknown as { _nodes: { id: string; label: string }[] };
    editor.hass = makeHass({});
    editor.setConfig({ type: 'custom:mermaid-card', content: 'A --> B', entities: { A: 'light.a', Gone: 'light.b' } });
    document.body.append(editor);
    await editor.updateComplete;
    const warnings = () => [...editor.shadowRoot!.querySelectorAll('.stale')].map((p) => p.textContent?.trim());

    expect(warnings()).toEqual([]); // no ids yet: nothing can be judged

    internals._nodes = [{ id: 'A', label: 'A' }];
    await editor.updateComplete;
    expect(warnings()).toEqual(['This node is not in the diagram.']);
    const panels = editor.shadowRoot!.querySelectorAll('ha-expansion-panel');
    expect([panels[0].querySelector('.stale'), panels[1].querySelector('.stale')?.textContent?.trim()]).toEqual([
      null,
      'This node is not in the diagram.',
    ]);
    editor.remove();
  });
});

const named = (entity_id: string, friendly_name?: string): HassEntity => ({
  entity_id,
  state: 'on',
  attributes: { friendly_name },
});
const states = (...entities: HassEntity[]) => Object.fromEntries(entities.map((e) => [e.entity_id, e]));

describe('suggestEntity', () => {
  it('matches the friendly name to the node text, trimmed and ignoring case', () => {
    expect(suggestEntity('A', ' heat PUMP ', states(named('switch.x', 'Heat pump'), named('light.y', 'Lamp')))).toBe(
      'switch.x',
    );
  });

  it('falls back to the object id matching the lowercased node id', () => {
    expect(suggestEntity('Boiler', 'Something', states(named('switch.boiler'), named('light.boiler_2')))).toBe(
      'switch.boiler',
    );
    expect(suggestEntity('Boiler', undefined, states(named('switch.boiler')))).toBe('switch.boiler');
  });

  it('suggests nothing when several entities match, or none', () => {
    expect(suggestEntity('A', 'Lamp', states(named('light.a', 'Lamp'), named('light.b', 'Lamp')))).toBe('');
    expect(suggestEntity('pump', '', states(named('switch.pump'), named('sensor.pump')))).toBe('');
    expect(suggestEntity('X', 'Nothing', states(named('light.a', 'Lamp')))).toBe('');
  });
});

describe('MermaidCardEditor entity suggestion', () => {
  type Binding = { node: string; entity: string };
  const make = () => {
    const editor = new MermaidCardEditor();
    editor.hass = { states: states(named('switch.pump', 'Heat pump')) } as unknown as HomeAssistant;
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
