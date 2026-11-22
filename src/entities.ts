import type { HassEntity, NodeBinding } from './types';

// States that mean "nothing is happening"; everything else that is not a number counts as active.
const INACTIVE = new Set(['off', 'closed', 'idle', 'standby', 'not_home', 'locked', 'paused', 'docked', 'disarmed']);
const UNAVAILABLE = new Set(['unavailable', 'unknown']);

/** Whether the entity's state is one of a binding's `active_when` states. */
const matches = (entity: HassEntity, activeWhen: string | string[]) => [activeWhen].flat().includes(entity.state);

/**
 * The fill a bound node gets for its entity's state, or undefined to keep the diagram's own.
 * With `activeWhen`, only those states count as active, numbers included.
 */
export function stateColor(entity: HassEntity | undefined, activeWhen?: string | string[]): string | undefined {
  if (!entity || UNAVAILABLE.has(entity.state)) return 'var(--state-unavailable-color, var(--disabled-color))';
  const numeric = entity.state !== '' && !Number.isNaN(Number(entity.state));
  if (numeric && !activeWhen?.length) return undefined; // values belong in the label
  const domain = entity.entity_id.split('.')[0];
  return (!activeWhen?.length ? INACTIVE.has(entity.state) : !matches(entity, activeWhen))
    ? `var(--state-${domain}-inactive-color, var(--state-inactive-color))`
    : `var(--state-${domain}-active-color, var(--state-active-color, var(--amber-color)))`;
}

/**
 * Whether an entity counts as running: on, open, heating, or a number other than zero; with
 * `activeWhen`, only in one of those states.
 */
export function isActive(entity: HassEntity | undefined, activeWhen?: string | string[]): boolean {
  if (!entity?.state || UNAVAILABLE.has(entity.state)) return false;
  if (activeWhen?.length) return matches(entity, activeWhen);
  if (INACTIVE.has(entity.state)) return false;
  return Number(entity.state) !== 0; // NaN for text states, which count as active
}

/** A binding in its long form, whichever form the config wrote it in. */
export const toBinding = (value: string | NodeBinding): NodeBinding =>
  typeof value === 'string' ? { entity: value } : value;

/**
 * Seconds one run of Mermaid's dash keyframes takes for a `speed: auto` edge: from 50 s (Mermaid's
 * slow) for a value near zero to 5 s at `max`. The value goes in on a log scale, so a few watts
 * still visibly move next to kilowatts; the speed in between is linear in that, not the duration.
 */
export function edgeDuration(value: number, max = 10000): number {
  const fraction = Math.min(1, Math.log1p(Math.abs(value)) / Math.log1p(max));
  return Math.round((900 / (18 + fraction * (180 - 18))) * 10) / 10; // the keyframes run 900 px
}

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

/** Something a binding can attach to: its key, and whether it takes the state colour. */
interface Target {
  element: SVGElement;
  key: string;
  tint: boolean;
}

/** A label as shown: its text, with line breaks and markup read as spaces. */
function shownText(element: Element | null | undefined): string {
  if (!element) return '';
  const parts: string[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) parts.push(walker.currentNode.textContent ?? '');
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Everything in the diagram a binding can name. Mermaid gives a node no `data-id`, only a DOM id:
 * `<render id>-flowchart-<node id>-<n>` (`state-…`, `classId-…`), or `<render id>-<id>` for Gantt
 * tasks and kanban items and columns. Mind maps, pies and sankeys keep no ids of their own, so
 * their nodes, slices and legend entries are named by their label.
 */
function findTargets(root: ParentNode): Target[] {
  const targets: Target[] = [];
  for (const element of root.querySelectorAll<SVGElement>('.node, .icon-shape, .cluster, rect.task')) {
    const svgId = element.ownerSVGElement?.id;
    const key =
      /-(?:flowchart|state|classId)-(.+)-\d+$/.exec(element.id)?.[1] ??
      (element.classList.contains('mindmap-node') ? shownText(element) : undefined) ??
      (svgId && element.id.startsWith(`${svgId}-`) ? element.id.slice(svgId.length + 1) : undefined);
    if (key) targets.push({ element, key, tint: true });
  }
  // Chart colours carry meaning of their own, so slices and sankey nodes only take actions.
  for (const svg of root.querySelectorAll('svg')) {
    const labels = svg.querySelectorAll<SVGElement>(':scope .node-labels > text');
    svg.querySelectorAll<SVGElement>(':scope .nodes > .node').forEach((node, index) => {
      const label = labels[index];
      const key = label?.textContent?.split('\n')[0].trim(); // a second line holds the value
      if (key) targets.push({ element: node, key, tint: false }, { element: label, key, tint: false });
    });
    // Mermaid draws no slice that rounds to 0 %, but keeps its legend entry. Slices follow the
    // legend's order and colour, so a legend entry whose colour the next slice lacks has none.
    const slices = [...svg.querySelectorAll<SVGElement>('.pieCircle')];
    const probe = document.createElement('i');
    let next = 0;
    for (const legend of svg.querySelectorAll<SVGElement>('.legend')) {
      const key = shownText(legend).replace(/ \[[^\]]*\]$/, ''); // `showData` adds ` [value]`
      if (!key) continue;
      targets.push({ element: legend, key, tint: false });
      probe.style.fill = slices[next]?.getAttribute('fill') ?? '';
      if (probe.style.fill && probe.style.fill === legend.querySelector('rect')?.style.fill)
        targets.push({ element: slices[next++], key, tint: false });
    }
  }
  return targets;
}

/** Colours the nodes named in `bindings` after their entity and makes them run their actions. */
export function bindNodes(
  root: ParentNode,
  bindings: Record<string, string | NodeBinding>,
  states: Record<string, HassEntity>,
  onAction: (binding: NodeBinding, action: 'tap' | 'hold') => void,
): void {
  const targets = findTargets(root);
  // Edges carry their id as data-id (clusters do too, but they are not paths).
  const edges = [...root.querySelectorAll<SVGPathElement>('path[data-id]')];
  for (const [nodeId, value] of Object.entries(bindings)) {
    const binding = toBinding(value);
    const entity = states[binding.entity];
    for (const edge of edges.filter((candidate) => candidate.dataset.id === nodeId)) {
      const color = isActive(entity, binding.active_when)
        ? (stateColor(entity, binding.active_when) ?? 'var(--state-active-color)')
        : undefined;
      // The entity only turns the animation on and off; how it moves is the diagram's choice:
      // `animation: slow`, a classDef's own animation (inline on the path), or else fast.
      const own = (edge.dataset.ownAnimation ??= edge.classList.contains('edge-animation-slow')
        ? 'slow'
        : edge.style.animation || 'fast');
      edge.classList.toggle('edge-animation-fast', Boolean(color) && own === 'fast');
      edge.classList.toggle('edge-animation-slow', Boolean(color) && own === 'slow');
      if (own === 'fast' || own === 'slow') {
        // Mermaid pins an edge it does not animate at offset 0, where the dash keyframes would then
        // start and end: the line dashed, but standing still. Start where Mermaid's own classes do.
        const pinned = (edge.dataset.ownDashoffset ??= edge.style.strokeDashoffset);
        edge.style.strokeDashoffset = color ? '900px' : pinned;
      } else edge.style.animation = color ? own : 'none'; // which also resets the longhands below
      // `speed: auto` sets only duration and direction: dash pattern and keyframes stay the diagram's.
      const value = Number(entity?.state);
      const auto = Boolean(color) && binding.speed === 'auto' && Number.isFinite(value);
      if (auto || own === 'fast' || own === 'slow') {
        edge.style.animationDuration = auto ? `${edgeDuration(value, binding.max)}s` : '';
        edge.style.animationDirection = auto && value < 0 ? 'reverse' : ''; // e.g. export to the grid
      }
      if (color) edge.style.setProperty('stroke', color, 'important');
      else edge.style.removeProperty('stroke');
      colorMarkers(edge, color);
    }
    for (const { element: node, tint } of targets.filter((target) => target.key === nodeId)) {
      const color = stateColor(entity, binding.active_when);
      // An icon shape has no body to tint, only its frame and label box: its icon takes the colour below.
      // A Gantt task is a bare rect, its own body.
      const shapes =
        !tint || node.classList.contains('icon-shape')
          ? []
          : node.tagName === 'rect'
            ? [node]
            : node.querySelectorAll<SVGElement>(
                ':scope > rect, :scope > polygon, :scope > circle, :scope > ellipse, :scope > path, :scope > g > path, :scope > g > rect',
              );
      for (const shape of shapes) {
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
      // A mind map labels in its section's text colour, white on the section's own fill: on the tint
      // the label needs the theme's.
      if (tint && node.classList.contains('mindmap-node')) {
        for (const label of node.querySelectorAll<SVGElement>('span, text')) {
          if (color)
            label.style.setProperty(
              label.tagName === 'text' ? 'fill' : 'color',
              'var(--primary-text-color)',
              'important',
            );
          else label.style.removeProperty(label.tagName === 'text' ? 'fill' : 'color');
        }
      }
      // An icon draws in currentColor from an inline `color`: it takes the state colour, as a tile card's icon does.
      for (const icon of node.querySelectorAll<SVGElement>('g[style*="color"]')) {
        const own = (icon.dataset.ownColor ??= icon.style.color);
        icon.style.color = color ?? own;
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
