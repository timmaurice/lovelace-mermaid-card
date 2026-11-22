import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures/hass';
import { setState, useDashboard } from './helpers/homeassistant';

// The README's catalog: one card per diagram type, each on live demo states with what the card
// adds where the type allows it (templates, bindings, moving edges, icons). Every run checks
// that they all render; `npm run catalog` also writes the screenshots to docs/catalog.
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../../docs/catalog');

const STATES: [string, string, Record<string, unknown>][] = [
  ['sensor.solar_power', '3200', { friendly_name: 'Solar', unit_of_measurement: 'W' }],
  ['sensor.grid_power', '900', { friendly_name: 'Grid', unit_of_measurement: 'W' }],
  ['sensor.heat_pump_power', '2300', { friendly_name: 'Heat pump', unit_of_measurement: 'W' }],
  ['sensor.washer_power', '650', { friendly_name: 'Washer', unit_of_measurement: 'W' }],
  ['switch.heat_pump', 'on', { friendly_name: 'Heat pump' }],
  ['switch.washer', 'on', { friendly_name: 'Washer' }],
  ['switch.dishwasher', 'off', { friendly_name: 'Dishwasher' }],
  ['light.kitchen', 'on', { friendly_name: 'Kitchen' }],
  ['light.living_room', 'off', { friendly_name: 'Living room' }],
  ['light.bedroom', 'off', { friendly_name: 'Bedroom' }],
  ['light.hall', 'on', { friendly_name: 'Hall light' }],
  ['binary_sensor.hall_motion', 'on', { friendly_name: 'Hall motion', device_class: 'motion' }],
  ['sensor.living_room_temperature', '21.6', { friendly_name: 'Living room', unit_of_measurement: '°C' }],
  ['sensor.bedroom_temperature', '19.2', { friendly_name: 'Bedroom', unit_of_measurement: '°C' }],
  ['sensor.living_room_humidity', '48', { friendly_name: 'Living room humidity', unit_of_measurement: '%' }],
  ['sensor.bedroom_humidity', '56', { friendly_name: 'Bedroom humidity', unit_of_measurement: '%' }],
  [
    'climate.living_room',
    'heat',
    { friendly_name: 'Living room', current_temperature: 21.6, temperature: 22, hvac_action: 'heating' },
  ],
  ['vacuum.robot', 'cleaning', { friendly_name: 'Robot' }],
  ['input_boolean.chore_filter', 'off', { friendly_name: 'Clean the vacuum filter' }],
  ['input_boolean.chore_bulb', 'off', { friendly_name: 'Replace hall bulb' }],
  ['input_boolean.chore_battery', 'on', { friendly_name: 'Smoke alarm battery' }],
  ['sensor.door_battery', '82', { friendly_name: 'Door sensor', unit_of_measurement: '%' }],
  ['sensor.remote_battery', '18', { friendly_name: 'Remote', unit_of_measurement: '%' }],
  ['sensor.smoke_battery', '35', { friendly_name: 'Smoke alarm', unit_of_measurement: '%' }],
  ['sensor.thermostat_battery', '71', { friendly_name: 'Thermostat', unit_of_measurement: '%' }],
];

type Card = { file: string; title: string } & Record<string, unknown>;

const CATALOG: Card[] = [
  {
    file: 'flowchart',
    title: 'Energy flow',
    content: `flowchart LR
  SOLAR@{ icon: "mdi:solar-power", label: "Solar<br>{{ states('sensor.solar_power') }} W" }
  GRID@{ icon: "mdi:transmission-tower", label: "Grid<br>{{ states('sensor.grid_power') }} W" }
  HOME[Home]
  HP@{ icon: "mdi:heat-pump", label: "Heat pump<br>{{ states('sensor.heat_pump_power') }} W" }
  WASH@{ icon: "mdi:washing-machine", label: "Washer<br>{{ states('sensor.washer_power') }} W" }
  SOLAR solar@--> HOME
  GRID grid@--> HOME
  HOME hp@--> HP
  HOME wash@--> WASH`,
    entities: {
      solar: { entity: 'sensor.solar_power', speed: 'auto', max: 4000 },
      grid: { entity: 'sensor.grid_power', speed: 'auto', max: 4000 },
      hp: { entity: 'sensor.heat_pump_power', speed: 'auto', max: 4000 },
      wash: { entity: 'sensor.washer_power', speed: 'auto', max: 4000 },
      HP: 'switch.heat_pump',
      WASH: 'switch.washer',
    },
  },
  {
    file: 'state',
    title: 'Robot vacuum',
    content: `stateDiagram-v2
  direction LR
  [*] --> Docked
  Docked --> Cleaning: schedule
  Cleaning --> Returning: done
  Returning --> Docked
  Cleaning --> Error: stuck`,
    entities: {
      Docked: { entity: 'vacuum.robot', active_when: 'docked' },
      Cleaning: { entity: 'vacuum.robot', active_when: 'cleaning' },
      Returning: { entity: 'vacuum.robot', active_when: 'returning' },
      Error: { entity: 'vacuum.robot', active_when: 'error' },
    },
  },
  {
    file: 'mindmap',
    title: 'Lights',
    content: `mindmap
root((Home))
  Ground floor
    Kitchen
    Living room
    Hall light
  First floor
    Bedroom`,
    entities: {
      Kitchen: 'light.kitchen',
      'Living room': 'light.living_room',
      'Hall light': 'light.hall',
      Bedroom: 'light.bedroom',
    },
  },
  {
    file: 'pie',
    title: 'Power now',
    content: `pie showData
  "Heat pump" : {{ states('sensor.heat_pump_power') }}
  "Washer" : {{ states('sensor.washer_power') }}
  "Everything else" : {{ (states('sensor.solar_power') | float + states('sensor.grid_power') | float - states('sensor.heat_pump_power') | float - states('sensor.washer_power') | float) | round(0) }}`,
    entities: { 'Heat pump': 'sensor.heat_pump_power', Washer: 'sensor.washer_power' },
  },
  {
    file: 'gantt',
    title: 'Appliances today',
    diagram_type: 'gantt',
    content: `dateFormat HH:mm
axisFormat %H:%M
todayMarker off
section Laundry
Wash :wash, 08:00, 90m
Dry :dry, after wash, 60m
section Kitchen
Dishwasher :dish, 12:30, 120m`,
    entities: { wash: 'switch.washer', dish: 'switch.dishwasher' },
  },
  {
    file: 'kanban',
    title: 'Chores',
    diagram_type: 'kanban',
    content: `{%- set chores = expand('input_boolean.chore_filter', 'input_boolean.chore_bulb', 'input_boolean.chore_battery') %}
todo[To do]
{%- for e in chores | selectattr('state', 'eq', 'off') %}
  {{ e.object_id }}[{{ e.name }}]
{%- endfor %}
done[Done]
{%- for e in chores | selectattr('state', 'eq', 'on') %}
  {{ e.object_id }}[{{ e.name }}]
{%- endfor %}`,
    entities: {
      chore_filter: { entity: 'input_boolean.chore_filter', tap_action: { action: 'toggle' } },
      chore_bulb: { entity: 'input_boolean.chore_bulb', tap_action: { action: 'toggle' } },
      chore_battery: { entity: 'input_boolean.chore_battery', tap_action: { action: 'toggle' } },
    },
  },
  {
    file: 'sankey',
    title: 'Where the power goes',
    content: `---
config:
  sankey: { showValues: true, linkColor: source }
---
sankey-beta
Solar,Home,{{ states('sensor.solar_power') }}
Grid,Home,{{ states('sensor.grid_power') }}
Home,Heat pump,{{ states('sensor.heat_pump_power') }}
Home,Washer,{{ states('sensor.washer_power') }}
Home,Everything else,{{ (states('sensor.solar_power') | float + states('sensor.grid_power') | float - states('sensor.heat_pump_power') | float - states('sensor.washer_power') | float) | round(0) }}`,
    entities: { Solar: 'sensor.solar_power', Grid: 'sensor.grid_power', 'Heat pump': 'sensor.heat_pump_power' },
  },
  {
    file: 'sequence',
    title: 'Hall light',
    content: `sequenceDiagram
  participant S as Hall motion
  participant HA as Home Assistant
  participant L as Hall light
  S->>HA: {{ state_translated('binary_sensor.hall_motion') }}
  HA->>L: turn on
  Note over HA,L: light is {{ states('light.hall') }}
  HA->>L: off after 3 minutes`,
  },
  {
    file: 'class',
    title: 'Thermostat',
    content: `classDiagram
  class Living_room["{{ state_attr('climate.living_room', 'friendly_name') }}"] {
    +state {{ states('climate.living_room') }}
    +current {{ state_attr('climate.living_room', 'current_temperature') }} °C
    +target {{ state_attr('climate.living_room', 'temperature') }} °C
    +set_temperature()
  }
  class Heat_pump["Heat pump"] {
    +power {{ states('sensor.heat_pump_power') }} W
    +turn_on()
  }
  Living_room --> Heat_pump : asks for heat`,
    entities: { Living_room: 'climate.living_room', Heat_pump: 'switch.heat_pump' },
  },
  {
    file: 'er',
    title: 'How Home Assistant is built',
    content: `erDiagram
  direction LR
  AREA ||--o{ DEVICE : contains
  DEVICE ||--|{ ENTITY : provides
  ENTITY ||--o{ AUTOMATION : triggers`,
  },
  {
    file: 'timeline',
    title: 'Sun today',
    content: `timeline
  {{ as_local(as_datetime(state_attr('sun.sun', 'next_rising'))).strftime('%H.%M') }} : Sunrise : Blinds up
  Day : Away mode
  {{ as_local(as_datetime(state_attr('sun.sun', 'next_setting'))).strftime('%H.%M') }} : Sunset : Evening scene
  Night : Night mode`,
  },
  {
    file: 'journey',
    title: 'Coming home',
    content: `journey
  section Arriving
    Garage opens: 4: Me
    Hall light on: {{ 5 if is_state('light.hall', 'on') else 2 }}: Home Assistant
  section Evening
    Living room warm: {{ 5 if states('sensor.living_room_temperature') | float >= 21 else 3 }}: Home Assistant`,
  },
  {
    file: 'xychart',
    title: 'Temperatures',
    content: `---
config:
  xyChart: { height: 280 }
---
xychart-beta
  x-axis ["Living room", "Bedroom"]
  y-axis "°C" 15 --> 25
  bar [{{ states('sensor.living_room_temperature') }}, {{ states('sensor.bedroom_temperature') }}]`,
  },
  {
    file: 'quadrant',
    title: 'Batteries',
    content: `quadrantChart
  x-axis Rarely used --> Often used
  y-axis Empty --> Full
  quadrant-1 Fine
  quadrant-2 Fine
  quadrant-3 Replace soon
  quadrant-4 Replace now
  Door sensor: [0.25, {{ states('sensor.door_battery') | float / 100 }}]
  Remote: [0.85, {{ states('sensor.remote_battery') | float / 100 }}]
  Smoke alarm: [0.1, {{ states('sensor.smoke_battery') | float / 100 }}]
  Thermostat: [0.65, {{ states('sensor.thermostat_battery') | float / 100 }}]`,
  },
  {
    file: 'radar',
    title: 'Room comfort',
    content: `radar-beta
  axis t["Temperature"], h["Humidity"], l["Light"]
  curve living["Living room"]{ {{ states('sensor.living_room_temperature') | float / 5 }}, {{ states('sensor.living_room_humidity') | float / 20 }}, {{ 5 if is_state('light.living_room', 'on') else 1 }} }
  curve bed["Bedroom"]{ {{ states('sensor.bedroom_temperature') | float / 5 }}, {{ states('sensor.bedroom_humidity') | float / 20 }}, {{ 5 if is_state('light.bedroom', 'on') else 1 }} }
  max 5`,
  },
  {
    file: 'treemap',
    title: 'Power by device',
    content: `treemap-beta
"Home"
    "Heat pump": {{ states('sensor.heat_pump_power') }}
    "Washer": {{ states('sensor.washer_power') }}
    "Everything else": {{ (states('sensor.solar_power') | float + states('sensor.grid_power') | float - states('sensor.heat_pump_power') | float - states('sensor.washer_power') | float) | round(0) }}`,
  },
  {
    file: 'block',
    title: 'Energy system',
    content: `block-beta
  columns 3
  Solar Battery Grid
  space:3
  House["House<br>{{ (states('sensor.solar_power') | float + states('sensor.grid_power') | float) | round(0) }} W"]:3
  Solar --> House
  Battery --> House
  Grid --> House`,
  },
  {
    file: 'architecture',
    title: 'Network',
    content: `architecture-beta
  group home(mdi:home)[Home network]
  service router(mdi:router-wireless)[Router] in home
  service ha(mdi:home-assistant)[Home Assistant] in home
  service nas(mdi:nas)[NAS] in home
  router:R -- L:ha
  ha:R -- L:nas`,
  },
  {
    file: 'gitgraph',
    title: 'Config history',
    content: `gitGraph
  commit id: "2026.10"
  branch dashboard
  commit id: "Energy view"
  checkout main
  commit id: "2026.11"
  merge dashboard`,
  },
];

// The states stay after the run, so the catalog dashboard keeps working when shown in the sidebar.
test.beforeAll(async () => {
  for (const [entityId, state, attributes] of STATES) await setState(entityId, state, attributes);
});

test('every catalog diagram renders', async ({ page, consoleErrors }) => {
  const urlPath = await useDashboard('catalog', {
    views: [
      {
        title: 'Catalog',
        type: 'panel',
        cards: [
          {
            type: 'vertical-stack',
            cards: CATALOG.map((card) => ({ type: 'custom:mermaid-card', ...card, file: undefined })), // JSON drops it
          },
        ],
      },
    ],
  });
  // Narrow enough that the sidebar folds away, wide enough for the wide types to fit.
  await page.setViewportSize({ width: 820, height: 900 });
  await page.goto(`/${urlPath}/0`);
  const cards = page.locator('mermaid-card');
  await expect(cards.locator('svg[aria-roledescription]')).toHaveCount(CATALOG.length, { timeout: 60_000 });
  await expect(cards.locator('ha-alert')).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
  if (!process.env.CATALOG) return;

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  // Both themes: the README shows GitHub's dark mode the dark ones.
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(1500); // the theme re-renders the diagrams; icons and moving edges settle
    for (const [index, { file }] of CATALOG.entries()) {
      const name = scheme === 'dark' ? `${file}-dark` : file;
      const png = resolve(OUT, `${name}.png`);
      await cards.nth(index).locator('ha-card').screenshot({ path: png, animations: 'disabled' });
      execFileSync('cwebp', ['-quiet', '-q', '85', png, '-o', resolve(OUT, `${name}.webp`)]);
      rmSync(png);
    }
  }
});
