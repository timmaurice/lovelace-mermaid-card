// Lazy loader for Mermaid. The library is embedded as a string (see rollup.config.js) and only
// executed here, on the first diagram, as a classic script: its build assigns `globalThis.mermaid`
// through a top-level `var`, which a module would keep private.
import source from 'virtual:mermaid-source';
import { findEdges, findTargets, shownText } from './entities';

export interface MermaidApi {
  initialize(config: Record<string, unknown>): void;
  render(id: string, text: string): Promise<{ svg: string; bindFunctions?: (element: Element) => void }>;
  parse(text: string): Promise<unknown>;
  /** Missing from an older Mermaid that another resource already put on the page. */
  registerIconPacks?(packs: { name: string; icons: object }[]): void;
}

export interface DiagramNode {
  id: string;
  label: string;
  /** The text the node shows, without its id. */
  text: string;
  /** An edge: it can show its entity, but takes no tap or hold. */
  edge?: boolean;
}

const node = (id: string, text = ''): DiagramNode => ({
  id,
  label: text && text !== id ? `${id} – ${text}` : id,
  text,
});

let listCount = 0;

/**
 * What a binding can name in the diagram, found as the card finds it: the diagram is drawn and
 * searched with the card's own lookup. Nodes, clusters, Gantt tasks, kanban items, mind map,
 * pie and sankey labels come first, then edges.
 * Text that does not parse yields no nodes and Mermaid's error message. Expects rendered text:
 * Mermaid cannot parse a template.
 */
export async function listNodes(text: string): Promise<{ nodes: DiagramNode[]; error?: string }> {
  try {
    const mermaid = await loadMermaid();
    const error = await mermaid.parse(text).then(
      () => undefined,
      (reason: unknown) => (reason instanceof Error ? reason.message : String(reason)),
    );
    if (error !== undefined) return { nodes: [], error };
    const { svg } = await mermaid.render(`mermaid-card-list-${++listCount}`, text);
    const root = new DOMParser().parseFromString(svg, 'image/svg+xml');
    // A Gantt task's text is a sibling with the same id, not inside it.
    const textOf = (id: string) =>
      [...root.querySelectorAll(`[data-id="${CSS.escape(id)}"]`)].map(shownText).find(Boolean) ?? '';
    const nodes = new Map<string, DiagramNode>();
    for (const { element, key } of findTargets(root)) {
      if (nodes.has(key) || key.startsWith('root_')) continue; // a state diagram's [*] start and end
      nodes.set(key, node(key, shownText(element) || textOf(element.dataset.id ?? '')));
    }
    for (const edge of findEdges(root)) {
      const id = edge.dataset.id!;
      const [start, end] = (edge.dataset.ast ?? '').replace(/^e:/, '').split('>');
      if (!nodes.has(id)) nodes.set(id, { id, label: end ? `${id} – ${start} → ${end}` : id, text: '', edge: true });
    }
    return { nodes: [...nodes.values()] };
  } catch {
    return { nodes: [] };
  }
}

declare global {
  var mermaid: MermaidApi | undefined;
}

let loading: Promise<MermaidApi> | undefined;

export function loadMermaid(): Promise<MermaidApi> {
  loading ??= new Promise<MermaidApi>((resolve, reject) => {
    if (globalThis.mermaid) return resolve(globalThis.mermaid);
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const script = document.createElement('script');
    script.src = url;
    script.onload = () => {
      URL.revokeObjectURL(url);
      if (globalThis.mermaid) resolve(globalThis.mermaid);
      else reject(new Error('Mermaid did not load'));
    };
    script.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Mermaid did not load'));
    };
    document.head.append(script);
  }).catch((error) => {
    loading = undefined; // let the next render try again
    throw error;
  });
  return loading;
}
