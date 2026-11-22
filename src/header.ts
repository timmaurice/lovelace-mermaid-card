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
  /** Whether the header says more than its type and direction, like `pie showData`. */
  extra?: boolean;
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
  const extra = !/^[ \t]*;?[ \t]*$/.test(direction ? header[2].replace(DIRECTION, '') : header[2]);
  return { prefix, type, direction, extra, body: after.slice(header[0].length) };
}

/** The type the content's own header declares, if it has one. */
export function diagramType(content: string): string | undefined {
  return split(content).type;
}

/**
 * Takes the header out of the content, returning its type and flowchart direction separately. A
 * header that says more (`pie showData`, `xychart-beta horizontal`) stays, since the options
 * could not hold the rest; its type is still returned.
 */
export function stripHeader(content: string): { content: string; type?: string; direction?: string } {
  const { prefix, type, direction, extra, body } = split(content);
  return { content: type && !extra ? prefix + body : content, type, direction };
}

/** The content as Mermaid needs it: its own header if it has one, else one built from the options. */
export function withHeader(content: string, type = 'flowchart', direction?: string): string {
  const { prefix, type: own, body } = split(content);
  if (own) return content;
  return `${prefix}${type}${type === 'flowchart' && direction ? ` ${direction}` : ''}\n${body}`;
}

/**
 * A small starting point per type, like Home Assistant's template editor offers. Each reads live
 * what every installation has (the sun, the home zone, the states, the area registry), so it
 * renders as it is and shows what a template can do in that diagram type.
 */
export const EXAMPLES: Record<(typeof DIAGRAM_TYPES)[number], string> = {
  flowchart: `  SUN(["Sun<br>{{ state_translated('sun.sun') }}"]) --> DARK{Dark outside?}
  DARK yes@-->|yes| SCENE[Evening scene]
  DARK no@-->|no| NOTHING[Nothing to do]
  {%- set dark = is_state('sun.sun', 'below_horizon') %}
  {{ 'yes' if dark else 'no' }}@{ animation: slow }
  class {{ 'SCENE' if dark else 'NOTHING' }} taken
  classDef taken stroke:#ffc107,stroke-width:3px`,
  sequenceDiagram: `  participant S as Sun
  participant HA as Home Assistant
  participant L as Lights
  S->>HA: {{ state_translated('sun.sun') }}, {{ state_attr('sun.sun', 'elevation') }}° high
  Note over S,HA: next sunset {{ as_timestamp(state_attr('sun.sun', 'next_setting')) | timestamp_custom('%H:%M') }}
  HA->>L: {{ 'turn on' if is_state('sun.sun', 'below_horizon') else 'stay off' }}`,
  'stateDiagram-v2': `  state "Day" as above_horizon
  state "Night" as below_horizon
  [*] --> {{ states('sun.sun') }}
  above_horizon --> below_horizon: sunset {{ as_timestamp(state_attr('sun.sun', 'next_setting')) | timestamp_custom('%H:%M') }}
  below_horizon --> above_horizon: sunrise {{ as_timestamp(state_attr('sun.sun', 'next_rising')) | timestamp_custom('%H:%M') }}
  class {{ states('sun.sun') }} current
  classDef current stroke:#ffc107,stroke-width:3px`,
  classDiagram: `  class Home {
    +people home {{ states('zone.home') }}
    +areas {{ areas() | count }}
    +entities {{ states | count }}
  }
  class Sun {
    +state {{ states('sun.sun') }}
    +elevation {{ state_attr('sun.sun', 'elevation') }}°
    +azimuth {{ state_attr('sun.sun', 'azimuth') }}°
  }
  Home --> Sun : lights by`,
  erDiagram: `  direction LR
  FLOOR ||--o{ AREA : groups
  AREA ||--o{ ENTITY : contains
  ENTITY ||--o{ AUTOMATION : triggers
  FLOOR {
    int count "{{ floors() | count }} here"
  }
  AREA {
    int count "{{ areas() | count }} here"
  }
  ENTITY {
    int count "{{ states | count }} here"
  }
  AUTOMATION {
    int count "{{ states.automation | count }} here"
  }`,
  gantt: `  dateFormat HH:mm
  axisFormat %H:%M
  todayMarker off
  {%- set sunrise = as_timestamp(state_attr('sun.sun', 'next_rising')) | timestamp_custom('%H:%M') %}
  {%- set sunset = as_timestamp(state_attr('sun.sun', 'next_setting')) | timestamp_custom('%H:%M') %}
  section Sun
  Night :00:00, {{ sunrise }}
  Day :{{ sunrise }}, {{ sunset }}
  Evening :{{ sunset }}, 23:59
  section Now
  {{ now().strftime('%H.%M') }} :milestone, {{ now().strftime('%H:%M') }}, 0m`,
  pie: `  title Entities by domain
  {%- set ns = namespace(rows=[]) %}
  {%- for domain, items in states | groupby('domain') %}{% set ns.rows = ns.rows + [(items | count, domain)] %}{% endfor %}
  {%- set rows = ns.rows | sort(reverse=true) %}
  {%- for count, domain in rows[:5] %}
  "{{ domain }}" : {{ count }}
  {%- endfor %}
  {%- if rows | count > 5 %}
  "other" : {{ rows[5:] | map(attribute='0') | sum }}
  {%- endif %}`,
  mindmap: `  root(({{ state_attr('zone.home', 'friendly_name') or 'Home' }}))
  {%- for f in floors() %}
    f_{{ f }}("{{ floor_name(f) | replace('"', '') }}")
  {%- for a in floor_areas(f) %}
      a_{{ a }}["{{ area_name(a) | replace('"', '') }}"]
  {%- endfor %}
  {%- endfor %}
  {%- for a in areas() if not floor_id(a) %}
    a_{{ a }}["{{ area_name(a) | replace('"', '') }}"]
  {%- endfor %}`,
  timeline: `  title Today
  {%- set events = [
    (as_timestamp(now()), 'Now', 'Home Assistant runs'),
    (as_timestamp(state_attr('sun.sun', 'next_rising')), 'Sunrise', 'Blinds up'),
    (as_timestamp(state_attr('sun.sun', 'next_setting')), 'Sunset', 'Evening scene'),
  ] | sort %}
  {%- for time, name, action in events %}
  {{ time | timestamp_custom('%H.%M') }} {{ name }} : {{ action }}
  {%- endfor %}`,
  journey: `  title Coming home
  section Arriving
    Someone is home: {{ 5 if states('zone.home') | int(0) > 0 else 2 }}: Home
    Lights on if dark: {{ 5 if is_state('sun.sun', 'below_horizon') else 3 }}: Home Assistant
  section Evening
    Sun down: {{ 5 if is_state('sun.sun', 'below_horizon') else 1 }}: Home Assistant`,
};
