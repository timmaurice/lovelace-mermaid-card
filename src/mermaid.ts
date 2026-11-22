// Lazy loader for Mermaid. The library is embedded as a string (see rollup.config.js) and only
// executed here, on the first diagram, as a classic script: its build assigns `globalThis.mermaid`
// through a top-level `var`, which a module would keep private.
import source from 'virtual:mermaid-source';

type NodeMap = Map<string, { text?: string; label?: string }>;

export interface MermaidApi {
  initialize(config: Record<string, unknown>): void;
  render(id: string, text: string): Promise<{ svg: string; bindFunctions?: (element: Element) => void }>;
  parse(text: string): Promise<unknown>;
  /** Missing from an older Mermaid that another resource already put on the page. */
  registerIconPacks?(packs: { name: string; icons: object }[]): void;
  mermaidAPI: {
    getDiagramFromText(text: string): Promise<{
      db: {
        getVertices?(): NodeMap;
        getStates?(): NodeMap;
        getClasses?(): NodeMap;
        getEdges?(): { id?: string; start: string; end: string }[];
        getTasks?(): { id: string; task: string }[]; // Gantt
        getMindmap?(): MindmapNode | null;
        getSections?(): unknown; // pie: label -> value; Gantt and kanban: a list
        getData?(): { nodes: { id: string; label?: string }[] }; // kanban (flowcharts have it too)
        getNodes?(): { ID: string }[]; // sankey
      };
    }>;
  };
}

interface MindmapNode {
  descr: string;
  children: MindmapNode[];
}

export interface DiagramNode {
  id: string;
  label: string;
  /** The text the node shows, without its id. */
  text: string;
  /** An edge: it can show its entity, but takes no tap or hold. */
  edge?: boolean;
}

const breaks = (text: string) => text.replace(/<br\s*\/?>/gi, ' ');
// A mind map label as the card matches it: as shown, without its markdown's * and backticks.
const shown = (text: string) => breaks(text).replace(/[*`]/g, '');
const node = (id: string, text = ''): DiagramNode => ({
  id,
  label: text && text !== id ? `${id} – ${text}` : id,
  text,
});

/** The keys a binding uses in the other bindable types: task and kanban ids, otherwise labels. */
function chartNodes(db: Awaited<ReturnType<MermaidApi['mermaidAPI']['getDiagramFromText']>>['db']): DiagramNode[] {
  if (db.getTasks) return db.getTasks().map((task) => node(task.id, task.task.trim()));
  if (db.getMindmap) {
    const walk = (item: MindmapNode | null | undefined): DiagramNode[] =>
      item ? [node(shown(item.descr), shown(item.descr)), ...item.children.flatMap(walk)] : [];
    return walk(db.getMindmap());
  }
  const sections = db.getSections?.();
  if (sections instanceof Map) return [...sections.keys()].map((label: string) => node(label, label));
  if (db.getData) return db.getData().nodes.map((item) => node(item.id, item.label));
  return db.getNodes?.().map((item) => node(item.ID, item.ID)) ?? [];
}

/**
 * The nodes a diagram defines, read with Mermaid's own parser: flowchart vertices, states and
 * classes, followed by a flowchart's edges; Gantt tasks, kanban items, and the labels of mind
 * map nodes, pie slices and sankey nodes.
 * Anything else, or text that does not parse, yields no nodes; text that does not parse also
 * yields Mermaid's error message. Expects rendered text: Mermaid cannot parse a template.
 */
export async function listNodes(text: string): Promise<{ nodes: DiagramNode[]; error?: string }> {
  try {
    const mermaid = await loadMermaid();
    // Parsing also loads the diagram type, which getDiagramFromText needs.
    const error = await mermaid.parse(text).then(
      () => undefined,
      (reason: unknown) => (reason instanceof Error ? reason.message : String(reason)),
    );
    if (error !== undefined) return { nodes: [], error };
    const { db } = await mermaid.mermaidAPI.getDiagramFromText(text);
    const nodes = db.getVertices?.() ?? db.getStates?.() ?? db.getClasses?.();
    if (!(nodes instanceof Map)) return { nodes: chartNodes(db) };
    const edges = (db.getVertices && db.getEdges?.()) || [];
    return {
      nodes: [
        ...[...nodes]
          .filter(([id]) => !id.startsWith('root_')) // a state diagram's [*] start and end
          .map(([id, vertex]) => node(id, breaks(String(vertex.text ?? vertex.label ?? '')))),
        ...edges
          .filter((edge) => edge.id)
          .map((edge) => ({ id: edge.id!, label: `${edge.id} – ${edge.start} → ${edge.end}`, text: '', edge: true })),
      ],
    };
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
