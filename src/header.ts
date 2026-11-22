// The first line of a Mermaid diagram names its type ("flowchart LR", "sequenceDiagram", …). The editor
// shows and changes it through a dropdown; the content itself stays plain Mermaid.

/** Types the editor offers, in the order it offers them. */
export const DIAGRAM_TYPES = [
  'flowchart',
  'sequenceDiagram',
  'stateDiagram-v2',
  'classDiagram',
  'erDiagram',
  'gantt',
  'pie',
  'mindmap',
  'timeline',
  'journey',
] as const;

/** Older spellings Mermaid still accepts, shown as the type they mean. */
const ALIASES: Record<string, string> = { graph: 'flowchart', stateDiagram: 'stateDiagram-v2' };

// Optional front matter and %% comment lines, then the header line itself.
const HEADER = /^((?:\s*---\n[\s\S]*?\n---[ \t]*\n)?(?:[ \t]*(?:%%.*)?\n)*)[ \t]*([A-Za-z][\w-]*)([^\n]*)/;

/** The diagram type the content declares, e.g. "flowchart", or undefined when it has no header. */
export function diagramType(content: string): string | undefined {
  const keyword = HEADER.exec(content)?.[2];
  return keyword ? (ALIASES[keyword] ?? keyword) : undefined;
}

/**
 * Rewrites the header line to declare `type`. A flowchart keeps the direction of a previous
 * flowchart header; any other change drops the rest of the line, which belonged to the old type.
 * Content without a header gets one in front.
 */
export function setDiagramType(content: string, type: string): string {
  const match = HEADER.exec(content);
  if (!match) return `${type}\n${content}`;
  const [whole, before, keyword, rest] = match;
  if ((ALIASES[keyword] ?? keyword) === type) return content;
  const keepRest = type === 'flowchart' && (keyword === 'flowchart' || keyword === 'graph');
  return `${before}${type}${keepRest ? rest : ''}${content.slice(whole.length)}`;
}
