// Mermaid names a diagram's type in its first line ("flowchart LR", "sequenceDiagram", …). The card
// keeps that type in the diagram_type option instead, so the content can start with the diagram
// itself. A header in the content still works, and wins: pasted Mermaid renders unchanged.

/** Types the editor offers, in the order it offers them. */
export const DIAGRAM_TYPES = [
  'flowchart',
  'sequenceDiagram',
  'stateDiagram-v2',
  'classDiagram',
  'erDiagram',
  'gantt',
  'pie',
  'mindmap',
  'timeline',
  'journey',
] as const;

/** Older spellings Mermaid still accepts, read as the type they mean. */
const ALIASES: Record<string, string> = { graph: 'flowchart', stateDiagram: 'stateDiagram-v2' };

/** Every keyword Mermaid accepts as a header, so a first line like `A --> B` is not mistaken for one. */
const KEYWORDS = new Set<string>([
  ...DIAGRAM_TYPES,
  ...Object.keys(ALIASES),
  'flowchart-elk',
  'classDiagram-v2',
  'gitGraph',
  'quadrantChart',
  'xychart',
  'xychart-beta',
  'sankey',
  'sankey-beta',
  'block',
  'block-beta',
  'requirementDiagram',
  'C4Context',
  'C4Container',
  'C4Component',
  'C4Dynamic',
  'C4Deployment',
  'architecture-beta',
  'packet',
  'packet-beta',
  'kanban',
  'radar-beta',
  'treemap-beta',
  'zenuml',
]);

const DIRECTION = /^[ \t]+(TB|TD|BT|RL|LR)\b/;

interface Split {
  /** Front matter and comment lines, which must stay in front of the header. */
  prefix: string;
  type?: string;
  direction?: string;
  /** Everything after the header line, or after the prefix when there is none. */
  body: string;
}

function split(content: string): Split {
  const prefix = /^(?:\s*---\n[\s\S]*?\n---[ \t]*\n)?(?:[ \t]*(?:%%.*)?\n)*/.exec(content)?.[0] ?? '';
  const after = content.slice(prefix.length);
  const header = /^[ \t]*([A-Za-z][\w-]*)([^\n]*)(?:\n|$)/.exec(after);
  if (!header || !KEYWORDS.has(header[1])) return { prefix, body: after };
  const type = ALIASES[header[1]] ?? header[1];
  const direction = type === 'flowchart' ? DIRECTION.exec(header[2])?.[1] : undefined;
  return { prefix, type, direction, body: after.slice(header[0].length) };
}

/** The type the content's own header declares, if it has one. */
export function diagramType(content: string): string | undefined {
  return split(content).type;
}

/** Takes the header out of the content, returning its type and flowchart direction separately. */
export function stripHeader(content: string): { content: string; type?: string; direction?: string } {
  const { prefix, type, direction, body } = split(content);
  return { content: type ? prefix + body : content, type, direction };
}

/** The content as Mermaid needs it: its own header if it has one, else one built from the options. */
export function withHeader(content: string, type = 'flowchart', direction?: string): string {
  const { prefix, type: own, body } = split(content);
  if (own) return content;
  return `${prefix}${type}${type === 'flowchart' && direction ? ` ${direction}` : ''}\n${body}`;
}

/**
 * A small starting point per type, like Home Assistant's template editor offers. Only entities
 * every installation has (sun.sun) appear, so each example renders as it is.
 */
export const EXAMPLES: Record<(typeof DIAGRAM_TYPES)[number], string> = {
  flowchart: `  SUN(["Sun<br>{{ state_translated('sun.sun') }}"]) --> HOME[Home]
  HOME --> DARK{Dark outside?}
  DARK -->|yes| SCENE[Evening scene]
  DARK -->|no| NOTHING[Nothing to do]`,
  sequenceDiagram: `  participant S as Motion sensor
  participant HA as Home Assistant
  participant L as Hall light
  S->>HA: motion detected
  HA->>L: turn on
  Note over HA,L: off again after 3 minutes
  HA->>L: turn off`,
  'stateDiagram-v2': `  [*] --> Docked
  Docked --> Cleaning: schedule
  Cleaning --> Returning: done
  Returning --> Docked
  Cleaning --> Error: stuck
  Error --> Docked: reset`,
  classDiagram: `  class Room {
    +name
    +temperature
  }
  class Light {
    +brightness
    +turn_on()
    +turn_off()
  }
  Room "1" --> "*" Light`,
  erDiagram: `  AREA ||--o{ DEVICE : contains
  DEVICE ||--|{ ENTITY : provides
  ENTITY ||--o{ AUTOMATION : triggers`,
  gantt: `  dateFormat HH:mm
  axisFormat %H:%M
  section Laundry
  Wash :wash, 08:00, 90m
  Dry  :after wash, 60m
  section Dishes
  Dishwasher :10:00, 120m`,
  pie: `  title Energy today
  "Heating" : 42
  "Kitchen" : 18
  "Office" : 25`,
  mindmap: `  root((Home))
    Ground floor
      Kitchen
      Living room
    First floor
      Bedroom
      Bathroom`,
  timeline: `  title Today
  Morning : Wake-up light : Coffee machine on
  Daytime : Away mode
  Evening : Welcome home
  Night : Night mode`,
  journey: `  title Coming home
  section Arriving
    Open the garage: 4: Me
    Lights turn on: 5: Home Assistant
  section Evening
    Heating ready: 5: Home Assistant`,
};
