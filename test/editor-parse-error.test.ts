import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HomeAssistant } from '../src/types';

const listNodes = vi.fn<(text: string) => Promise<{ nodes: { id: string; label: string }[]; error?: string }>>(
  async () => ({ nodes: [] }),
);
vi.mock('../src/mermaid', () => ({ loadMermaid: async () => ({}), listNodes }));

const { MermaidCardEditor, parseErrorText } = await import('../src/editor');

// Mermaid 12's message for `flowchart\nA -->`: it reports an unexpected end a line past the end.
const MESSAGE = "Parse error on line 3:\nflowchartA -->\n--------------^\nExpecting 'AMP', 'COLON', got 'EOF'";
const SHOWN = "Parse error on line 1: Expecting 'AMP', 'COLON', got 'EOF'";

type Editor = InstanceType<typeof MermaidCardEditor>;
const parseError = (editor: Editor) => (editor as unknown as { _parseError?: string })._parseError;

async function edit(editor: Editor, content: string, result: { error?: string }) {
  listNodes.mockResolvedValueOnce({ nodes: [], ...result });
  editor.setConfig({ type: 'custom:mermaid-card', content });
  await vi.advanceTimersByTimeAsync(500);
}

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('parseErrorText', () => {
  it('drops the code excerpt and counts lines as the content field does', () => {
    expect(parseErrorText(MESSAGE, 'flowchart\nA -->')).toBe(SHOWN);
    const midway = "Parse error on line 3:\n... A --> --> B\n-------^\nExpecting 'ID', got '-->'";
    expect(parseErrorText(midway, 'flowchart\nA --> B\nA --> --> B\nB --> C')).toBe(
      "Parse error on line 2: Expecting 'ID', got '-->'",
    );
    expect(parseErrorText('No diagram type detected', 'x')).toBe('No diagram type detected');
  });
});

describe('editor parse error', () => {
  it('shows the error at the content field and clears it once the text parses', async () => {
    vi.useFakeTimers();
    const editor = new MermaidCardEditor();
    editor.hass = { states: {}, connection: { subscribeMessage: vi.fn() } } as unknown as HomeAssistant;
    document.body.append(editor);

    await edit(editor, 'A -->', { error: MESSAGE });
    expect(listNodes).toHaveBeenLastCalledWith('flowchart\nA -->');
    await editor.updateComplete;
    const form = () => editor.shadowRoot!.querySelector('ha-form') as unknown as { error?: Record<string, string> };
    expect(form().error).toEqual({ content: SHOWN });

    await edit(editor, 'A --> B', {});
    await editor.updateComplete;
    expect(form().error).toBeUndefined();
  });

  it('checks templates rendered by Home Assistant, but not blanked ones', async () => {
    vi.useFakeTimers();
    const content = "A --> {{ states('sun.sun') }}";

    // Rendered by Home Assistant: the text is what the card will see.
    const subscribeMessage = vi.fn((callback: (message: { result?: string }) => void) => {
      setTimeout(() => callback({ result: 'flowchart\nA --> ' }));
      return Promise.resolve(() => undefined);
    });
    const editor = new MermaidCardEditor();
    editor.hass = { states: {}, connection: { subscribeMessage } } as unknown as HomeAssistant;
    await edit(editor, content, { error: MESSAGE });
    expect(listNodes).toHaveBeenLastCalledWith('flowchart\nA --> ');
    expect(parseError(editor)).toBe(SHOWN);

    // A header that comes after template lines is the content's own, as in the card: no flowchart
    // header goes in front, and the form shows the type the text declares.
    const gantt = "{%- set start = '08:00' %}\ngantt\nWash :wash, {{ start }}, 1h";
    const header = vi.fn((callback: (message: { result?: string }) => void, params: { template: string }) => {
      setTimeout(() => callback({ result: params.template.startsWith('{%') ? 'gantt\nWash :wash, 08:00, 1h' : '?' }));
      return Promise.resolve(() => undefined);
    });
    const ganttEditor = new MermaidCardEditor();
    ganttEditor.hass = { states: {}, connection: { subscribeMessage: header } } as unknown as HomeAssistant;
    document.body.append(ganttEditor);
    await edit(ganttEditor, gantt, {});
    expect(listNodes).toHaveBeenLastCalledWith('gantt\nWash :wash, 08:00, 1h');
    await ganttEditor.updateComplete;
    const ganttForm = ganttEditor.shadowRoot!.querySelector('ha-form') as unknown as { data: { diagram_type: string } };
    expect(ganttForm.data.diagram_type).toBe('gantt');

    // Without Home Assistant the templates are blanked: a guess, so no error.
    const offline = new MermaidCardEditor();
    await edit(offline, content, { error: MESSAGE });
    expect(listNodes).toHaveBeenLastCalledWith('flowchart\nA --> …');
    expect(parseError(offline)).toBeUndefined();
  });
});
