import { describe, expect, it, vi } from 'vitest';
import { automationFlowchart, type AutomationTrace } from '../src/automation';
import type { HomeAssistant } from '../src/types';

vi.mock('../src/mermaid', () => ({
  loadMermaid: async () => ({ initialize: vi.fn(), render: vi.fn(async () => ({ svg: '<svg></svg>' })) }),
}));
const { MermaidCard } = await import('../src/mermaid-card');

const ran = (...paths: string[]): AutomationTrace => ({
  trace: Object.fromEntries(paths.map((path) => [path, [{ path }]])),
});
const classes = (text: string, name: string) =>
  text.match(new RegExp(`^  class (\\S+) ${name}$`, 'm'))?.[1].split(',') ?? [];
const animated = (text: string) => [...text.matchAll(/^ {2}(e\d+)@\{ animation: slow \}$/gm)].map((match) => match[1]);
const edge = (text: string, id: string) =>
  new RegExp(`^ {2}(\\S+) ${id}@-->(?:\\|"[^"]*"\\|)? (\\S+)$`, 'm').exec(text);

// The new spellings, as the automation editor saves them since 2024.10.
const hallLight = {
  id: '1700000000001',
  alias: 'Hall light',
  triggers: [{ trigger: 'state', entity_id: 'binary_sensor.hall_motion', to: 'on' }],
  conditions: [{ condition: 'state', entity_id: 'input_boolean.guest_mode', state: 'off' }],
  actions: [
    { action: 'light.turn_on', target: { entity_id: 'light.hall' }, data: { brightness_pct: 60 } },
    { delay: { minutes: 3 } },
    { alias: 'Lights off again', action: 'light.turn_off', target: { entity_id: 'light.hall' } },
  ],
};

describe('automationFlowchart', () => {
  it('draws triggers, conditions and actions top to bottom with readable labels', () => {
    const text = automationFlowchart(hallLight, undefined, (id) => (id === 'light.hall' ? 'Hall' : id));
    expect(text.split('\n')[0]).toBe('flowchart TB');
    expect(text).toContain('start(["Hall light"])');
    expect(text).toContain('trigger_0("binary_sensor.hall_motion → on")');
    expect(text).toContain('condition_0{{"input_boolean.guest_mode is off"}}');
    expect(text).toContain('action_0["light.turn_on → Hall"]');
    expect(text).toContain('action_1["Delay 3 minutes"]');
    expect(text).toContain('action_2["Lights off again"]');
    expect(edge(text, 'e0')?.slice(1)).toEqual(['start', 'trigger_0']);
    expect(edge(text, 'e1')?.slice(1)).toEqual(['trigger_0', 'condition_0']);
    expect(edge(text, 'e4')?.slice(1)).toEqual(['action_1', 'action_2']);
    // Without a trace nothing is highlighted.
    expect(classes(text, 'ran')).toEqual([]);
    expect(animated(text)).toEqual([]);
  });

  it('highlights a full run and animates every edge along it', () => {
    const trace = ran('trigger/0', 'condition/0', 'action/0', 'action/1', 'action/2');
    const text = automationFlowchart(hallLight, trace);
    expect(classes(text, 'ran')).toEqual(['start', 'trigger_0', 'condition_0', 'action_0', 'action_1', 'action_2']);
    expect(animated(text)).toEqual(['e0', 'e1', 'e2', 'e3', 'e4']);
  });

  it('stops the path at a condition that did not pass', () => {
    const trace: AutomationTrace = {
      trace: {
        'trigger/0': [{ path: 'trigger/0' }],
        'condition/0': [{ path: 'condition/0', result: { result: false } }],
      },
    };
    const text = automationFlowchart(hallLight, trace);
    expect(classes(text, 'ran')).toEqual(['start', 'trigger_0', 'condition_0']);
    expect(animated(text)).toEqual(['e0', 'e1']);
  });

  it('reads the old spellings and follows the choose branch that was taken', () => {
    const config = {
      alias: 'Evening',
      trigger: [
        { platform: 'state', entity_id: 'binary_sensor.front_door', to: 'on' },
        { platform: 'time', at: '22:00:00' },
      ],
      condition: [],
      action: [
        { service: 'notify.mobile_app', data: { message: 'Evening' } },
        {
          choose: [
            {
              conditions: [{ condition: 'state', entity_id: 'sun.sun', state: 'below_horizon' }],
              sequence: [{ service: 'scene.turn_on', data: { entity_id: 'scene.evening' } }],
            },
          ],
          default: [{ service: 'light.turn_off', entity_id: 'light.porch' }],
        },
      ],
    };
    const trace: AutomationTrace = {
      trace: {
        'trigger/1': [{ path: 'trigger/1' }],
        'action/0': [{ path: 'action/0' }],
        'action/1': [{ path: 'action/1', result: { choice: 0 } }],
        'action/1/choose/0/sequence/0': [{ path: 'action/1/choose/0/sequence/0' }],
      },
    };
    const text = automationFlowchart(config, trace);
    expect(text).toContain('trigger_1("At 22:00:00")');
    expect(text).toContain('action_0["notify.mobile_app"]');
    expect(text).toContain('action_1{"Choose"}');
    expect(text).toContain('action_1_choose_0_sequence_0["scene.turn_on → scene.evening"]');
    expect(text).toContain('action_1_default_0["light.turn_off → light.porch"]');
    expect(text).toMatch(/action_1 e\d+@-->\|"sun.sun is below_horizon"\| action_1_choose_0_sequence_0/);
    expect(classes(text, 'ran')).not.toContain('trigger_0');
    expect(classes(text, 'ran')).not.toContain('action_1_default_0');
    const moving = animated(text).map((id) => edge(text, id)!.slice(1).join(' -> '));
    expect(moving).toEqual([
      'start -> trigger_1',
      'trigger_1 -> action_0',
      'action_0 -> action_1',
      'action_1 -> action_1_choose_0_sequence_0',
    ]);
  });

  it('marks a failed step and draws if, repeat, wait and unknown items', () => {
    const config = {
      triggers: [{ trigger: 'sun', event: 'sunset', offset: '-00:30:00' }, { trigger: 'webhook' }],
      actions: [
        {
          if: [{ condition: 'numeric_state', entity_id: 'sensor.lux', below: 20 }],
          then: [{ action: 'cover.close_cover', target: { area_id: 'living_room' } }],
        },
        { repeat: { count: 3, sequence: [{ action: 'light.toggle', target: { entity_id: 'light.porch' } }] } },
        { wait_for_trigger: [{ trigger: 'state', entity_id: 'binary_sensor.door', to: 'off' }] },
        { some_future_action: true },
      ],
    };
    const trace: AutomationTrace = {
      trace: {
        'trigger/0': [{ path: 'trigger/0' }],
        'action/0': [{ path: 'action/0', result: { choice: 'then' } }],
        'action/0/then/0': [{ path: 'action/0/then/0', error: 'Cover is unavailable' }],
      },
    };
    const text = automationFlowchart(config, trace);
    expect(text).toContain('trigger_0("Sun: sunset -00:30:00")');
    expect(text).toContain('trigger_1("webhook")');
    expect(text).toContain('action_0{"If sensor.lux below 20"}');
    expect(text).toContain('action_1[["Repeat 3×"]]');
    expect(text).toContain('action_1_repeat_sequence_0 -.-> action_1');
    expect(text).toContain('action_2["Wait for binary_sensor.door → off"]');
    expect(text).toContain('action_3["Action"]');
    expect(text).toMatch(/action_0 e\d+@-->\|"else"\| action_1/);
    expect(classes(text, 'failed')).toEqual(['action_0_then_0']);
    expect(text.indexOf('classDef failed')).toBeGreaterThan(text.indexOf('classDef ran')); // failed wins
  });

  it('quotes labels safely and shortens long ones', () => {
    const text = automationFlowchart({ alias: 'Say "hi"', actions: [{ alias: 'x'.repeat(80), event: 'e' }] });
    expect(text).toContain('start(["Say #quot;hi#quot;"])');
    expect(text).toMatch(/action_0\["x{47}…"\]/);
  });
});

describe('MermaidCard with an automation', () => {
  it('requires an automation entity instead of content', () => {
    expect(() => new MermaidCard().setConfig({ type: 'custom:mermaid-card', automation: 'light.x' })).toThrow(
      /automation/,
    );
    expect(() =>
      new MermaidCard().setConfig({ type: 'custom:mermaid-card', automation: 'automation.x' }),
    ).not.toThrow();
  });

  it('fetches the config and the latest trace, binds the start node and refreshes after a run', async () => {
    const send = vi.fn(async (message: Record<string, unknown>) => {
      if (message.type === 'automation/config') return { config: hallLight };
      if (message.type === 'trace/list') {
        return [
          { run_id: 'new', timestamp: { start: '2026-11-22T18:00:00+00:00' } },
          { run_id: 'old', timestamp: { start: '2026-11-21T18:00:00+00:00' } },
        ];
      }
      return ran('trigger/0', 'condition/0', 'action/0');
    });
    const state = (last_triggered: string) => ({
      entity_id: 'automation.hall_light',
      state: 'on',
      attributes: { id: '1700000000001', last_triggered, current: 0 },
    });
    const hass = (lastTriggered: string) =>
      ({
        states: { 'automation.hall_light': state(lastTriggered) },
        themes: { darkMode: false },
        connection: { subscribeMessage: vi.fn(), sendMessagePromise: send },
      }) as unknown as HomeAssistant;
    const card = new MermaidCard();
    card.setConfig({ type: 'custom:mermaid-card', automation: 'automation.hall_light' });
    card.hass = hass('2026-11-22T18:00:00+00:00');
    document.body.append(card);
    await vi.waitFor(() => expect((card as unknown as { _text?: string })._text).toContain('class start,'));

    expect(send.mock.calls.map(([message]) => message)).toEqual([
      { type: 'automation/config', entity_id: 'automation.hall_light' },
      { type: 'trace/list', domain: 'automation', item_id: '1700000000001' },
      { type: 'trace/get', domain: 'automation', item_id: '1700000000001', run_id: 'new' },
    ]);
    expect((card as unknown as { _config: { entities: unknown } })._config.entities).toEqual({
      start: 'automation.hall_light',
    });

    card.hass = hass('2026-11-22T18:00:00+00:00'); // a new hass object, same run: nothing fetched
    await card.updateComplete;
    expect(send).toHaveBeenCalledTimes(3);
    card.hass = hass('2026-11-22T19:00:00+00:00');
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(6));
    card.remove();
  });
});
