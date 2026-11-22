# Mermaid Card

A Home Assistant Lovelace card that renders [Mermaid](https://mermaid.js.org/) diagrams — flowcharts, state, sequence, class, Gantt and more — styled with your Home Assistant theme and kept live with your entity states.

- **Live values:** the diagram source is a Home Assistant template, so labels can show states.
- **Bound nodes:** map a node to an entity and it is coloured by that entity's state; tapping it opens more-info.
- **AI friendly:** any Mermaid an assistant writes can go straight into `content` (or into a sensor attribute the template reads).

## Configuration

| Option      | Type   | Required | Description                                                                                                           |
| ----------- | ------ | -------- | --------------------------------------------------------------------------------------------------------------------- |
| `content`   | string | yes      | Mermaid source. May contain templates (`{{ states('sensor.x') }}`).                                                   |
| `title`     | string | no       | Card header.                                                                                                          |
| `entities`  | map    | no       | Node id → entity id. Works for flowchart, state and class diagrams.                                                   |
| `direction` | string | no       | Overrides a flowchart's direction: `TB`, `TD`, `BT`, `LR` or `RL`. Handy when the same diagram sits in a narrow card. |

```yaml
type: custom:mermaid-card
title: Heating
content: |
  flowchart LR
    HP[Heat pump] --> BOIL[("Boiler<br>{{ states('sensor.boiler_temperature') }} °C")]
    BOIL --> LR["Living room<br>{{ state_attr('climate.living_room', 'current_temperature') }} °C"]
entities:
  HP: switch.heat_pump
  LR: climate.living_room
```

A diagram shrinks to fit the card down to three quarters of its natural size; beyond that it scrolls sideways, so the text stays readable. For a narrow card, `direction: TD` usually fits better than a wide `LR` flowchart.

Mermaid's hexagon shape `A{{text}}` collides with template syntax. Wrap such a diagram in `{% raw %}…{% endraw %}` or write the braces as `{{ '{{' }}` and `{{ '}}' }}`.

## Installation

Add this repository to HACS as a custom repository (category: Dashboard), install **Mermaid Card** and reload the browser.

Mermaid itself is bundled into the card (about 1.6 MB compressed) but only run when a diagram is shown.
