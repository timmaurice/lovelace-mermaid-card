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
 * Seconds one run of the dash keyframes takes for a `speed: auto` edge: from 50 s (the
 * slow speed) for a value near zero to 5 s at `max`. The value goes in as its square root: a quarter of
 * `max` moves half as fast as `max`, and a few watts still visibly move. A log scale made 650 W and
 * 3200 W look the same. The speed in between is linear in that, not the duration.
 */
export function edgeDuration(value: number, max = 10000): number {
  const fraction = Math.min(1, Math.sqrt(Math.abs(value) / max));
  return Math.round((900 / (18 + fraction * (180 - 18))) * 10) / 10; // the keyframes run 900 px
}

// A press this long is a hold, Home Assistant's own threshold.
const HOLD_MS = 500;

/** Something a binding can attach to: its key, and whether it takes the state colour. */
interface Target {
  element: SVGElement;
  key: string;
  tint: boolean;
}

/** A label as shown: its text, with line breaks and markup read as spaces. */
export function shownText(element: Element | null | undefined): string {
  if (!element) return '';
  const parts: string[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) parts.push(walker.currentNode.textContent ?? '');
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

// Mermaid prefixes some ids with their kind: kanban and mind map nodes, pie slices, sankey nodes.
const KIND = /^(?:n|slice|node):/;
const TARGETS =
  '.node[data-id], .cluster[data-id], rect.task[data-id], .mindmap-node, .pieCircle[data-id], .legend[data-id], .node-labels > text[data-id]';
const CHART = '[aria-roledescription="pie"], [aria-roledescription="sankey"]';

/**
 * Everything in the diagram a binding can name. Mermaid 13 puts the id on each node, cluster,
 * Gantt task, kanban item, pie slice with its legend entry, and sankey node with its label, as
 * `data-id`. Mind map nodes are named by their label, as the card did before 13.
 */
export function findTargets(root: ParentNode): Target[] {
  const targets: Target[] = [];
  for (const element of root.querySelectorAll<SVGElement>(TARGETS)) {
    const key = element.classList.contains('mindmap-node')
      ? shownText(element)
      : (element.dataset.id ?? '').replace(KIND, '');
    // Chart colours carry meaning of their own, so slices and sankey nodes only take actions.
    if (key) targets.push({ element, key, tint: !element.closest(CHART) });
  }
  return targets;
}

/** The edges a binding can name: their group, with the line and its arrowheads inside. */
export const findEdges = (root: ParentNode) => [...root.querySelectorAll<SVGElement>('.edgePaths > [data-id]')];

/** Colours the nodes named in `bindings` after their entity and makes them run their actions. */
export function bindNodes(
  root: ParentNode,
  bindings: Record<string, string | NodeBinding>,
  states: Record<string, HassEntity>,
  onAction: (binding: NodeBinding, action: 'tap' | 'hold') => void,
): void {
  const targets = findTargets(root);
  const edges = findEdges(root);
  for (const [nodeId, value] of Object.entries(bindings)) {
    const binding = toBinding(value);
    const entity = states[binding.entity];
    for (const edge of edges.filter((candidate) => candidate.dataset.id === nodeId)) {
      const line = edge.querySelector<SVGElement>(':scope > path:not(.marker)');
      const color = isActive(entity, binding.active_when)
        ? (stateColor(entity, binding.active_when) ?? 'var(--state-active-color)')
        : undefined;
      // The entity only turns the animation on and off; how fast it moves is the diagram's choice
      // (`animation: slow`), else fast. The card's styles animate these classes.
      const own = (edge.dataset.ownAnimation ??= edge.classList.contains('edge-animation-slow') ? 'slow' : 'fast');
      edge.classList.toggle('edge-animation-fast', Boolean(color) && own === 'fast');
      edge.classList.toggle('edge-animation-slow', Boolean(color) && own === 'slow');
      // `speed: auto` sets only duration and direction: dash pattern and keyframes stay the card's.
      const value = Number(entity?.state);
      const auto = Boolean(color) && binding.speed === 'auto' && Number.isFinite(value);
      for (const path of [line, ...edge.querySelectorAll<SVGElement>(':scope > path.marker')]) {
        if (!path) continue;
        if (color) path.style.setProperty(path === line ? 'stroke' : 'fill', color, 'important');
        else path.style.removeProperty(path === line ? 'stroke' : 'fill');
      }
      if (line) {
        line.style.animationDuration = auto ? `${edgeDuration(value, binding.max)}s` : '';
        line.style.animationDirection = auto && value < 0 ? 'reverse' : ''; // e.g. export to the grid
      }
    }
    for (const { element: node, tint } of targets.filter((target) => target.key === nodeId)) {
      const color = stateColor(entity, binding.active_when);
      // An icon shape has no body to tint: its icon takes the colour below.
      // A Gantt task is a bare rect, its own body.
      const shapes = !tint
        ? []
        : node.tagName === 'rect'
          ? [node]
          : node.querySelectorAll<SVGElement>(
              // `line`: a mind map node's underline in its section colour.
              ':scope > rect, :scope > polygon, :scope > circle, :scope > ellipse, :scope > path, :scope > line, :scope > g > path, :scope > g > rect',
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
      // An icon draws in currentColor from its group's `color`: it takes the state colour, as a tile card's icon does.
      for (const icon of node.querySelectorAll<SVGElement>('g[color]')) {
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
