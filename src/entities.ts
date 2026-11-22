import type { HassEntity } from './types';

// States that mean "nothing is happening"; everything else that is not a number counts as active.
const INACTIVE = new Set(['off', 'closed', 'idle', 'standby', 'not_home', 'locked', 'paused', 'docked', 'disarmed']);
const UNAVAILABLE = new Set(['unavailable', 'unknown']);

/** The fill a bound node gets for its entity's state, or undefined to keep the diagram's own. */
export function stateColor(entity: HassEntity | undefined): string | undefined {
  if (!entity || UNAVAILABLE.has(entity.state)) return 'var(--state-unavailable-color, var(--disabled-color))';
  if (entity.state !== '' && !Number.isNaN(Number(entity.state))) return undefined; // values belong in the label
  const domain = entity.entity_id.split('.')[0];
  return INACTIVE.has(entity.state)
    ? `var(--state-${domain}-inactive-color, var(--state-inactive-color))`
    : `var(--state-${domain}-active-color, var(--state-active-color, var(--amber-color)))`;
}

/** Whether an entity counts as running: on, open, heating, or a number other than zero. */
export function isActive(entity: HassEntity | undefined): boolean {
  if (!entity?.state || UNAVAILABLE.has(entity.state) || INACTIVE.has(entity.state)) return false;
  return Number(entity.state) !== 0; // NaN for text states, which count as active
}

/**
 * Colours the nodes named in `bindings` after their entity and makes them open more-info.
 * Mermaid gives a node no `data-id`, only a DOM id like `<render id>-flowchart-<node id>-<n>`
 * (`state-…` in state diagrams, `classId-…` in class diagrams), so that is what is matched.
 */
export function bindNodes(
  root: ParentNode,
  bindings: Record<string, string>,
  states: Record<string, HassEntity>,
  onTap: (entityId: string) => void,
): void {
  const nodes = [...root.querySelectorAll<SVGGElement>('.node')];
  // Edges carry their id as data-id (clusters do too, but they are not paths).
  const edges = [...root.querySelectorAll<SVGPathElement>('path[data-id]')];
  for (const [nodeId, entityId] of Object.entries(bindings)) {
    const entity = states[entityId];
    for (const edge of edges.filter((candidate) => candidate.dataset.id === nodeId)) {
      // Mermaid's own `animate: true` class, whose CSS every diagram already carries.
      const active = isActive(entity);
      edge.classList.toggle('edge-animation-fast', active);
      if (active) edge.style.setProperty('stroke', stateColor(entity) ?? 'var(--state-active-color)', 'important');
      else edge.style.removeProperty('stroke');
    }
    const pattern = new RegExp(
      `(?:^|-)(?:flowchart|state|classId)-${nodeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+$`,
    );
    for (const node of nodes.filter((candidate) => pattern.test(candidate.id))) {
      const color = stateColor(entity);
      for (const shape of node.querySelectorAll<SVGElement>(
        ':scope > rect, :scope > polygon, :scope > circle, :scope > ellipse, :scope > path, :scope > g > path, :scope > g > rect',
      )) {
        // A tint, not a solid fill: the label keeps the theme's text colour, which a full
        // amber or grey fill made unreadable in dark mode (same idea as the tile card's icon).
        if (color) {
          shape.style.setProperty(
            'fill',
            `color-mix(in srgb, ${color} 25%, var(--card-background-color, transparent))`,
            'important',
          );
          shape.style.setProperty('stroke', color, 'important');
        } else {
          shape.style.removeProperty('fill');
          shape.style.removeProperty('stroke');
        }
      }
      node.style.cursor = 'pointer';
      node.setAttribute('role', 'button');
      node.setAttribute('tabindex', '0');
      node.setAttribute('aria-label', entity?.attributes.friendly_name ?? entityId);
      node.onclick = () => onTap(entityId);
      node.onkeydown = (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onTap(entityId);
        }
      };
    }
  }
}
