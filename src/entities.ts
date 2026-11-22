import type { HassEntity, NodeBinding } from './types';

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

/** A binding in its long form, whichever form the config wrote it in. */
export const toBinding = (value: string | NodeBinding): NodeBinding =>
  typeof value === 'string' ? { entity: value } : value;

// A press this long is a hold, Home Assistant's own threshold.
const HOLD_MS = 500;

/**
 * Points an edge's arrowheads at copies filled with `color`, or back at Mermaid's own without one.
 * Markers are shared by all edges, so a coloured edge needs its own copy, as Mermaid's linkStyle
 * makes one.
 */
function colorMarkers(edge: SVGPathElement, color?: string): void {
  const svg = edge.ownerSVGElement;
  for (const attribute of ['marker-start', 'marker-end']) {
    const own = edge.getAttribute(`data-own-${attribute}`) ?? edge.getAttribute(attribute);
    const id = own && /url\(#(.+)\)/.exec(own)?.[1];
    if (!svg || !own || !id) continue;
    edge.setAttribute(`data-own-${attribute}`, own);
    if (!color) {
      edge.setAttribute(attribute, own);
      continue;
    }
    const copyId = `${id}__${color.replace(/[^\w-]/g, '_')}`;
    if (!svg.getElementById(copyId)) {
      const marker = svg.getElementById(id);
      if (!marker) continue;
      const copy = marker.cloneNode(true) as SVGElement;
      copy.id = copyId;
      for (const shape of copy.querySelectorAll<SVGElement>('path, circle')) {
        shape.style.setProperty('fill', color, 'important');
        shape.style.setProperty('stroke', color, 'important');
      }
      marker.after(copy);
    }
    edge.setAttribute(attribute, `url(#${copyId})`);
  }
}

/**
 * Colours the nodes named in `bindings` after their entity and makes them open more-info.
 * Mermaid gives a node no `data-id`, only a DOM id like `<render id>-flowchart-<node id>-<n>`
 * (`state-…` in state diagrams, `classId-…` in class diagrams), so that is what is matched.
 */
export function bindNodes(
  root: ParentNode,
  bindings: Record<string, string | NodeBinding>,
  states: Record<string, HassEntity>,
  onAction: (binding: NodeBinding, action: 'tap' | 'hold') => void,
): void {
  const nodes = [...root.querySelectorAll<SVGGElement>('.node')];
  // Edges carry their id as data-id (clusters do too, but they are not paths).
  const edges = [...root.querySelectorAll<SVGPathElement>('path[data-id]')];
  for (const [nodeId, value] of Object.entries(bindings)) {
    const binding = toBinding(value);
    const entity = states[binding.entity];
    for (const edge of edges.filter((candidate) => candidate.dataset.id === nodeId)) {
      const color = isActive(entity) ? (stateColor(entity) ?? 'var(--state-active-color)') : undefined;
      // The entity only turns the animation on and off; how it moves is the diagram's choice:
      // `animation: slow`, a classDef's own animation (inline on the path), or else fast.
      const own = (edge.dataset.ownAnimation ??= edge.classList.contains('edge-animation-slow')
        ? 'slow'
        : edge.style.animation || 'fast');
      edge.classList.toggle('edge-animation-fast', Boolean(color) && own === 'fast');
      edge.classList.toggle('edge-animation-slow', Boolean(color) && own === 'slow');
      if (own !== 'fast' && own !== 'slow') edge.style.animation = color ? own : 'none';
      if (color) edge.style.setProperty('stroke', color, 'important');
      else edge.style.removeProperty('stroke');
      colorMarkers(edge, color);
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
      node.setAttribute('aria-label', entity?.attributes.friendly_name ?? binding.entity);
      let timer: ReturnType<typeof setTimeout> | undefined;
      let held = false;
      // A long press only means something when the binding has a hold_action.
      node.onpointerdown = () => {
        held = false;
        clearTimeout(timer);
        if (binding.hold_action) timer = setTimeout(() => ((held = true), onAction(binding, 'hold')), HOLD_MS);
      };
      node.onpointerup = node.onpointerleave = () => clearTimeout(timer);
      node.onclick = () => {
        if (!held) onAction(binding, 'tap');
        held = false;
      };
      node.onkeydown = (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onAction(binding, 'tap');
        }
      };
    }
  }
}
