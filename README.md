# Mermaid Card

![GitHub release (latest by date)](https://img.shields.io/github/v/release/timmaurice/lovelace-mermaid-card?style=flat-square)
[![GH-last-commit](https://img.shields.io/github/last-commit/timmaurice/lovelace-mermaid-card.svg?style=flat-square)](https://github.com/timmaurice/lovelace-mermaid-card/commits/main)
![GitHub](https://img.shields.io/github/license/timmaurice/lovelace-mermaid-card?style=flat-square)

A Home Assistant Lovelace card that renders [Mermaid](https://mermaid.js.org/) diagrams — flowcharts, state, sequence, class, Gantt and more — styled with your Home Assistant theme and kept live with your entity states.

- **Live values:** the diagram source is a Home Assistant template, so labels can show states.
- **Bound nodes:** map a node to an entity and it is coloured by that entity's state; tapping it opens more-info, or runs the action you choose.
- **Live flows:** map an edge to an entity and it animates while that entity is active.
- **AI friendly:** any Mermaid an assistant writes can go straight into `content` (or into a sensor attribute the template reads).

## Configuration

The card has a visual editor. Pick the **Diagram type** from a dropdown; switching it on an empty diagram or an untouched example fills in an example of the new type. Mermaid pasted with its first line (`flowchart LR`, …) is understood: the editor moves the type and direction into their fields. Under **Bound nodes** you pick a node from a list the editor reads from your diagram, and an entity for it. When exactly one entity's friendly name matches the node's text, or its object id the node id, it is filled in for you. In a flowchart, **Add an entity as a node** appends a node with the entity's name and state and binds it in one step.

| Option         | Type   | Required | Description                                                                                                                                       |
| -------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `content`      | string | yes      | The diagram. May contain templates (`{{ states('sensor.x') }}`). A first line naming the type (`flowchart LR`, `sequenceDiagram`, …) is optional. |
| `diagram_type` | string | no       | Mermaid diagram type when `content` has no first line naming one: `flowchart` (default), `sequenceDiagram`, `stateDiagram-v2`, `pie`, …           |
| `title`        | string | no       | Card header.                                                                                                                                      |
| `entities`     | map    | no       | Node or edge id → entity id, or a mapping with `entity`, `tap_action`, `hold_action`. Works for flowchart, state and class diagrams.              |
| `direction`    | string | no       | A flowchart's direction: `TB` (top to bottom, the default), `BT`, `LR` or `RL`. Overrides a direction in the content's first line.                |
| `scale`        | number | no       | Size in percent of the diagram's natural size, e.g. `70`. Default `100` fits the diagram to the card.                                             |

```yaml
type: custom:mermaid-card
title: Heating
direction: LR
content: |
  HP[Heat pump] --> BOIL[("Boiler<br>{{ states('sensor.boiler_temperature') }} °C")]
  BOIL --> LR["Living room<br>{{ state_attr('climate.living_room', 'current_temperature') }} °C"]
entities:
  HP: switch.heat_pump
  LR: climate.living_room
```

### Bound nodes and edges

A bound node takes its entity's state colour. A tap opens more-info unless the binding sets a `tap_action`; a long press runs its `hold_action`. Both take Home Assistant's usual [actions](https://www.home-assistant.io/dashboards/actions/) (`toggle`, `navigate`, `perform-action`, …).

An edge is bound by its id. Name it with Mermaid's `@` syntax (`HP e1@--> BOIL`) or use the id the editor lists. While its entity is on, open, heating or a number other than zero, the edge animates in the entity's colour. Its arrowhead takes that colour too. How the edge moves is up to the diagram: Mermaid's [edge animations](https://mermaid.js.org/syntax/flowchart.html#turning-an-animation-on) (`e1@{ animation: slow }`, or a `classDef` with its own `animation`) are kept, and the entity only turns them on and off. Without one, a bound edge moves fast.

```yaml
type: custom:mermaid-card
content: |
  PUMP[Heat pump] flow@--> BOIL[Boiler]
  flow@{ animation: slow }
entities:
  PUMP:
    entity: switch.heat_pump
    hold_action:
      action: toggle
  flow: sensor.heat_pump_power
```

A diagram shrinks to fit the card down to three quarters of its natural size; beyond that it scrolls sideways, so the text stays readable. For a narrow card, `direction: TD` usually fits better than a wide `LR` flowchart. When a diagram does not fit, a button in the card's corner opens it at full size in a dialog, where bound nodes still work.

Mermaid's hexagon shape `A{{text}}` collides with template syntax. Wrap such a diagram in `{% raw %}…{% endraw %}` or write the braces as `{{ '{{' }}` and `{{ '}}' }}`.

## Installation

Add this repository to HACS as a custom repository (category: Dashboard), install **Mermaid Card** and reload the browser.

Mermaid itself is bundled into the card (about 1.6 MB compressed) but only run when a diagram is shown.

## Localization

The editor is available in English and German. Contributions of further languages are welcome: add a file to `src/translation/` and import it in `src/localize.ts`.

## Development

<details>
<summary>To contribute to the development, you'll need to set up a build environment.</summary>

1.  **Clone the repository:**

    ```bash
    git clone https://github.com/timmaurice/lovelace-mermaid-card.git
    cd lovelace-mermaid-card
    ```

2.  **Install dependencies:**

    ```bash
    npm install
    ```

3.  **Build the card** into `dist/mermaid-card.js`, or keep it rebuilding with `npm run watch`:

    ```bash
    npm run build
    ```

Run the unit tests with `npm test` (or keep them running with `npm run test:watch`) and the type check with `npm run typecheck`.

### Local Testing with Docker

`docker compose up -d` starts Home Assistant at [http://localhost:8137](http://localhost:8137) with `dist/` mounted as `/config/www`, so the card is served as `/local/mermaid-card.js`. Its configuration persists in `test/ha-config`.

### End-to-end tests

The Playwright suite runs from a fresh clone with one command (Docker and Node required):

```bash
npm ci && npx playwright install chromium && npm run test:e2e
```

Global setup builds the card, starts the compose Home Assistant, onboards it through the API (user `admin` / `password`) and registers the bundle as a Lovelace resource. CI runs the same thing in `.github/workflows/e2e.yml`.

</details>

---

For further assistance or to [report issues](https://github.com/timmaurice/lovelace-mermaid-card/issues), please visit the [GitHub repository](https://github.com/timmaurice/lovelace-mermaid-card).

## ☕ Support My Work

[<img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" height="30" />](https://www.buymeacoffee.com/timmaurice)
