// Lazy loader for Mermaid. The library is embedded as a string (see rollup.config.js) and only
// executed here, on the first diagram, as a classic script: its build assigns `globalThis.mermaid`
// through a top-level `var`, which a module would keep private.
import source from 'virtual:mermaid-source';

export interface MermaidApi {
  initialize(config: Record<string, unknown>): void;
  render(id: string, text: string): Promise<{ svg: string; bindFunctions?: (element: Element) => void }>;
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
