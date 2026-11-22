// Lazy loader for Mermaid. The library is embedded as a string (see rollup.config.js) and only
// executed here, on the first diagram, as a classic script: its build assigns `globalThis.mermaid`
// through a top-level `var`, which a module would keep private.
import source from 'virtual:mermaid-source';

type NodeMap = Map<string, { text?: string; label?: string }>;

export interface MermaidApi {
  initialize(config: Record<string, unknown>): void;
  render(id: string, text: string): Promise<{ svg: string; bindFunctions?: (element: Element) => void }>;
  parse(text: string): Promise<unknown>;
  mermaidAPI: {
    getDiagramFromText(text: string): Promise<{
      db: { getVertices?(): NodeMap; getStates?(): NodeMap; getClasses?(): NodeMap };
    }>;
  };
}

export interface DiagramNode {
  id: string;
  label: string;
}

/**
 * The nodes a diagram defines, read with Mermaid's own parser: flowchart vertices, states and
 * classes — the diagram types whose nodes the card can bind. Anything else, or text that does
 * not parse, yields no nodes. Expects rendered text: Mermaid cannot parse a template.
 */
export async function listNodes(text: string): Promise<DiagramNode[]> {
  try {
    const mermaid = await loadMermaid();
    await mermaid.parse(text); // loads the diagram type, which getDiagramFromText needs
    const { db } = await mermaid.mermaidAPI.getDiagramFromText(text);
    const nodes = db.getVertices?.() ?? db.getStates?.() ?? db.getClasses?.();
    if (!(nodes instanceof Map)) return [];
    return [...nodes]
      .filter(([id]) => !id.startsWith('root_')) // a state diagram's [*] start and end
      .map(([id, node]) => {
        const label = String(node.text ?? node.label ?? '').replace(/<br\s*\/?>/gi, ' ');
        return { id, label: label && label !== id ? `${id} – ${label}` : id };
      });
  } catch {
    return [];
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
