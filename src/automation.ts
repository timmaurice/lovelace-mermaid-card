// Draws a Home Assistant automation as a Mermaid flowchart, with the path of one run highlighted.

type Item = Record<string, unknown>;

/** One record of a trace step; a step that ran more than once (in a repeat) has several. */
export interface TraceStep {
  path: string;
  error?: string;
  result?: Record<string, unknown>;
}

/** What `trace/get` returns, as far as it is read here: records keyed by path (`action/1/choose/0/sequence/0`). */
export interface AutomationTrace {
  trace: Record<string, TraceStep[]>;
}

/** The node the card binds to the automation entity. */
export const START = 'start';

type Exit = { from: string; label?: string; ran: boolean };

// A string in a condition list is the template shorthand.
const list = (value: unknown): Item[] =>
  (value === undefined || value === null ? [] : [value].flat()).map((item) =>
    typeof item === 'string' ? { condition: 'template', value_template: item } : (item as Item),
  );

const label = (text: string) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return (flat.length > 48 ? `${flat.slice(0, 47)}…` : flat).replace(/"/g, '#quot;');
};

const range = (item: Item) =>
  `${item.above !== undefined ? ` above ${item.above}` : ''}${item.below !== undefined ? ` below ${item.below}` : ''}`;

function entities(item: Item, name: (id: string) => string): string {
  const target = (item.target ?? item.data ?? {}) as Item;
  const ids = item.entity_id ?? target.entity_id ?? target.area_id;
  return [ids]
    .flat()
    .filter((id): id is string => typeof id === 'string')
    .map(name)
    .join(', ');
}

function triggerLabel(trigger: Item, name: (id: string) => string): string {
  const platform = String(trigger.trigger ?? trigger.platform ?? 'trigger');
  const what = entities(trigger, name);
  switch (platform) {
    case 'state':
      return `${what}${trigger.to !== undefined && trigger.to !== null ? ` → ${trigger.to}` : ''}`;
    case 'numeric_state':
      return `${what}${range(trigger)}`;
    case 'time':
      return `At ${[trigger.at].flat().join(', ')}`;
    case 'sun':
      return `Sun: ${trigger.event}${trigger.offset ? ` ${trigger.offset}` : ''}`;
    case 'event':
      return `Event: ${trigger.event_type}`;
    case 'homeassistant':
      return `Home Assistant ${trigger.event}`;
  }
  return what ? `${platform}: ${what}` : platform;
}

function conditionLabel(condition: Item, name: (id: string) => string): string {
  const what = entities(condition, name);
  const nested = () => list(condition.conditions).map((item) => conditionLabel(item, name));
  switch (condition.condition) {
    case 'state':
      return `${what} is ${[condition.state].flat().join(' or ')}`;
    case 'numeric_state':
      return `${what}${range(condition)}`;
    case 'time':
    case 'sun':
      return ['after', 'before', 'weekday']
        .filter((key) => condition[key] !== undefined)
        .map((key) => `${key} ${[condition[key]].flat().join(', ')}`)
        .join(' ');
    case 'zone':
      return `${what} in ${name(String(condition.zone))}`;
    case 'trigger':
      return `Triggered by ${[condition.id].flat().join(' or ')}`;
    case 'and':
    case 'or':
      return nested().join(` ${condition.condition} `);
    case 'not':
      return `not (${nested().join(' or ')})`;
    case 'template':
      return 'Template';
  }
  return String(condition.condition ?? 'Condition');
}

function duration(value: unknown): string {
  if (typeof value === 'number') return `${value} s`;
  if (value && typeof value === 'object') {
    return Object.entries(value)
      .map(([unit, amount]) => `${amount} ${unit}`)
      .join(' ');
  }
  return String(value);
}

function actionLabel(action: Item, name: (id: string) => string): string {
  const what = entities(action, name);
  const service = action.action ?? action.service;
  if (typeof service === 'string') return `${service}${what ? ` → ${what}` : ''}`;
  if (action.delay !== undefined) return `Delay ${duration(action.delay)}`;
  if (action.wait_for_trigger !== undefined) {
    return `Wait for ${list(action.wait_for_trigger)
      .map((trigger) => triggerLabel(trigger, name))
      .join(' or ')}`;
  }
  if (action.wait_template !== undefined) return 'Wait for template';
  if (action.condition !== undefined) return conditionLabel(action, name);
  if (action.scene !== undefined) return `Scene ${name(String(action.scene))}`;
  if (action.event !== undefined) return `Event ${action.event}`;
  if (action.stop !== undefined) return `Stop: ${action.stop}`;
  if (action.variables !== undefined) return 'Set variables';
  if (action.parallel !== undefined) return 'Parallel';
  if (action.sequence !== undefined) return 'Sequence';
  return 'Action';
}

function repeatLabel(repeat: Item, name: (id: string) => string): string {
  if (repeat.count !== undefined) return `Repeat ${repeat.count}×`;
  if (repeat.for_each !== undefined) return 'Repeat for each';
  const kind = repeat.while !== undefined ? 'while' : 'until';
  return `Repeat ${kind} ${list(repeat[kind])
    .map((condition) => conditionLabel(condition, name))
    .join(' and ')}`;
}

/**
 * The automation as Mermaid flowchart text: its start node (id START), triggers, conditions and
 * actions top to bottom. With a trace, the steps that ran get `classDef ran`, failed ones `failed`,
 * and the edges along the path animate. Accepts the old (`trigger`, `platform`, `service`) and the
 * new (`triggers`, `trigger`, `action`) spellings.
 */
export function automationFlowchart(
  config: Item,
  trace?: AutomationTrace,
  name: (entityId: string) => string = (id) => id,
): string {
  const steps = trace?.trace ?? {};
  const lines = ['flowchart TB'];
  const ran = new Set<string>();
  const failed = new Set<string>();
  const animated: string[] = [];
  let edges = 0;

  const node = (path: string, [open, close]: [string, string], text: string): string => {
    const id = path.replace(/\W/g, '_');
    lines.push(`  ${id}${open}"${label(text)}"${close}`);
    if (path in steps) ran.add(id);
    if (steps[path]?.some((record) => record.error)) failed.add(id);
    return id;
  };
  const exit = (from: string, text?: string): Exit => ({ from, label: text, ran: ran.has(from) });
  const connect = (exits: Exit[], to: string) => {
    for (const { from, label: text, ran: taken } of exits) {
      const edge = `e${edges++}`;
      lines.push(`  ${from} ${edge}@-->${text ? `|"${label(text)}"|` : ''} ${to}`);
      if (taken && ran.has(to)) animated.push(edge);
    }
  };
  const alias = (item: Item) => (typeof item.alias === 'string' ? item.alias : undefined);

  const sequence = (actions: Item[], prefix: string, exits: Exit[]): Exit[] =>
    actions.reduce((open, action, index) => step(action, `${prefix}${index}`, open), exits);

  const step = (action: Item, path: string, exits: Exit[]): Exit[] => {
    const choice = steps[path]?.[0]?.result?.choice;
    if (action.choose !== undefined) {
      const decision = node(path, ['{', '}'], alias(action) ?? 'Choose');
      connect(exits, decision);
      const branches = list(action.choose).flatMap((option, index) => {
        const when = alias(option) ?? list(option.conditions).map((condition) => conditionLabel(condition, name));
        const taken = {
          from: decision,
          label: [when].flat().join(' and '),
          ran: ran.has(decision) && choice === index,
        };
        return sequence(list(option.sequence), `${path}/choose/${index}/sequence/`, [taken]);
      });
      // Home Assistant records no choice when nothing matched and there is no default.
      const otherwise = { from: decision, label: 'otherwise', ran: ran.has(decision) && typeof choice !== 'number' };
      return [...branches, ...sequence(list(action.default), `${path}/default/`, [otherwise])];
    }
    if (action.if !== undefined) {
      const conditions = list(action.if).map((condition) => conditionLabel(condition, name));
      const decision = node(path, ['{', '}'], alias(action) ?? `If ${conditions.join(' and ')}`);
      connect(exits, decision);
      const then = { from: decision, label: 'then', ran: ran.has(decision) && choice === 'then' };
      const otherwise = { from: decision, label: 'else', ran: ran.has(decision) && choice !== 'then' };
      return [
        ...sequence(list(action.then), `${path}/then/`, [then]),
        ...sequence(list(action.else), `${path}/else/`, [otherwise]),
      ];
    }
    if (action.repeat !== undefined) {
      const repeat = action.repeat as Item;
      const loop = node(path, ['[[', ']]'], alias(action) ?? repeatLabel(repeat, name));
      connect(exits, loop);
      for (const end of sequence(list(repeat.sequence), `${path}/repeat/sequence/`, [exit(loop)])) {
        lines.push(`  ${end.from} -.-> ${loop}`);
      }
      return [exit(loop)];
    }
    const shape: [string, string] = action.condition !== undefined ? ['{{', '}}'] : ['[', ']'];
    const id = node(path, shape, alias(action) ?? actionLabel(action, name));
    connect(exits, id);
    return [exit(id)];
  };

  const start = node(START, ['([', '])'], alias(config) ?? 'Automation');
  if (trace) ran.add(start);
  // shortcut: nested trigger lists (`triggers: [{ triggers: […] }]`) are drawn as one generic trigger.
  const triggers = list(config.triggers ?? config.trigger).map((trigger, index) => {
    const id = node(`trigger/${index}`, ['(', ')'], alias(trigger) ?? triggerLabel(trigger, name));
    connect([exit(start)], id);
    return exit(id);
  });
  let exits = triggers.length ? triggers : [exit(start)];
  list(config.conditions ?? config.condition).forEach((condition, index) => {
    const id = node(`condition/${index}`, ['{{', '}}'], alias(condition) ?? conditionLabel(condition, name));
    connect(exits, id);
    exits = [exit(id)];
  });
  sequence(list(config.actions ?? config.action), 'action/', exits);

  lines.push(...animated.map((edge) => `  ${edge}@{ animation: slow }`));
  // Mermaid's classDef rejects var(); these are Home Assistant's default active and error colours,
  // which read on light and dark cards alike.
  lines.push('  classDef ran stroke:#ffc107,stroke-width:3px', '  classDef failed stroke:#db4437,stroke-width:3px');
  if (ran.size) lines.push(`  class ${[...ran].join(',')} ran`);
  if (failed.size) lines.push(`  class ${[...failed].join(',')} failed`);
  return lines.join('\n');
}
