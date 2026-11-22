import { LitElement, css, html, nothing, unsafeCSS } from 'lit';
import { property, state } from 'lit/decorators.js';
import { DIAGRAM_TYPES, EXAMPLES, stripHeader, withHeader } from './header';
import { localize } from './localize';
import editorStyles from './styles/editor.styles.scss';
import { DiagramNode, listNodes } from './mermaid';
import { toBinding } from './entities';
import { TEMPLATE, type HassEntity, type HomeAssistant, type MermaidCardConfig, type NodeBinding } from './types';

export const EDITOR_ELEMENT_NAME = 'mermaid-card-editor';
const MDI_DELETE = 'M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z';

interface Binding extends NodeBinding {
  node: string;
}

/** The config's entities: a plain entity id per node, the long form only where there are actions. */
const toMap = (rows: Binding[]): Record<string, string | NodeBinding> =>
  Object.fromEntries(
    rows
      .filter((row) => row.node && row.entity)
      .map(({ node, entity, tap_action, hold_action }) => [
        node,
        tap_action || hold_action
          ? { entity, ...(tap_action && { tap_action }), ...(hold_action && { hold_action }) }
          : entity,
      ]),
  );

/**
 * The one entity that obviously belongs to a node: its friendly name is the node's text, or else
 * its object id is the node id. Several candidates mean no suggestion rather than a guess.
 */
export function suggestEntity(id: string, text: string | undefined, states: Record<string, HassEntity>): string {
  const name = text?.trim().toLowerCase();
  const entities = Object.values(states);
  for (const matches of [
    name
      ? entities.filter(
          (e) =>
            String(e.attributes.friendly_name ?? '')
              .trim()
              .toLowerCase() === name,
        )
      : [],
    entities.filter((e) => e.entity_id.split('.')[1] === id.toLowerCase()),
  ]) {
    if (matches.length) return matches.length === 1 ? matches[0].entity_id : '';
  }
  return '';
}

/**
 * Mermaid's parse error for `text` as the content field can show it. The parsed text has a header
 * line the field leaves out, so line numbers move up by one; an unexpected end is reported a line
 * past the end. The code excerpt and its caret line are dropped: they only line up in a monospace
 * block, and the alert collapses the line breaks.
 */
export function parseErrorText(message: string, text: string): string {
  const last = Math.max(1, text.split('\n').length - 1);
  const lines = message.split('\n');
  const caret = lines.findIndex((line) => /^-*\^\s*$/.test(line));
  if (caret > 0) lines.splice(caret - 1, 2);
  return lines
    .join(' ')
    .replace(/\bline (\d+)/g, (_, line: string) => `line ${Math.min(last, Math.max(1, Number(line) - 1))}`);
}

export class MermaidCardEditor extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private _config?: MermaidCardConfig;
  /** Rows as shown, including half-filled ones the config cannot hold yet. */
  @state() private _rows: Binding[] = [];
  @state() private _nodes: DiagramNode[] = [];
  /** Rows shown unfolded: the ones added here, which still need filling in. */
  @state() private _open = new Set<number>();
  @state() private _parseError?: string;
  private _nodesFor?: string;
  private _nodesTimer?: ReturnType<typeof setTimeout>;

  public setConfig(config: MermaidCardConfig): void {
    this._config = config;
    // Keep the rows on screen when the config is just our own last change echoed back.
    if (JSON.stringify(toMap(this._rows)) !== JSON.stringify(config.entities ?? {})) {
      this._rows = Object.entries(config.entities ?? {}).map(([node, value]) => ({ node, ...toBinding(value) }));
    }
    this._scheduleNodeList(this._source(config));
  }

  protected updated(changed: Map<string, unknown>): void {
    // Home Assistant may set the config before hass; templates can only be rendered with it.
    if (changed.has('hass') && !changed.get('hass') && this._config) {
      this._nodesFor = undefined;
      this._scheduleNodeList(this._source(this._config));
    }
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this._nodesTimer);
  }

  /** The Mermaid source the card renders for this config. */
  private _source(config: MermaidCardConfig): string {
    return withHeader(config.content ?? '', config.diagram_type, config.direction);
  }

  /**
   * The config as the form shows it: the type in its own dropdown and the content without a
   * header line, also for configs written before the option existed or pasted with one.
   */
  private _formData(config: MermaidCardConfig) {
    const { content, type, direction } = stripHeader(config.content ?? '');
    // Top to bottom is Mermaid's own default, and suits the narrow cards dashboards mostly have.
    const finalDirection = config.direction ?? direction ?? 'TB';
    return {
      ...config,
      content,
      diagram_type: type ?? config.diagram_type ?? 'flowchart',
      // TD is Mermaid's alias for TB; the dropdown offers each direction once.
      direction: finalDirection === 'TD' ? 'TB' : finalDirection,
      scale: config.scale ?? 100, // the slider shows the default instead of its minimum
    };
  }

  /** Re-reads the diagram's nodes, debounced: the content changes on every keystroke. */
  private _scheduleNodeList(content: string): void {
    if (content === this._nodesFor) return;
    this._nodesFor = content;
    clearTimeout(this._nodesTimer);
    this._nodesTimer = setTimeout(async () => {
      const { text, exact } = await this._renderOnce(content);
      const { nodes, error } = await listNodes(text);
      if (content !== this._nodesFor) return;
      this._nodes = nodes;
      // Blanked templates are only a guess at the text: an error there may not be in the content.
      this._parseError = exact && error ? parseErrorText(error, text) : undefined;
    }, 400);
  }

  /**
   * The content as the card will see it. Templates can hide Mermaid syntax — a hexagon `{{text}}`
   * is written `{{ '{{' }}text{{ '}}' }}` — so they are rendered by Home Assistant before parsing.
   * Without Home Assistant, or when rendering fails, the templates are blanked out instead; the
   * ids usually survive that. `exact` tells which: only exact text is worth a parse error.
   */
  private async _renderOnce(content: string): Promise<{ text: string; exact: boolean }> {
    if (!TEMPLATE.test(content)) return { text: content, exact: true };
    const blanked = {
      text: content
        .replace(/\{\{[\s\S]*?\}\}/g, '…')
        .replace(/\{%[\s\S]*?%\}/g, '')
        .replace(/\{#[\s\S]*?#\}/g, ''),
      exact: false,
    };
    const connection = this.hass?.connection;
    if (!connection) return blanked;
    return new Promise((resolve) => {
      const done = (result: { text: string; exact: boolean }) => {
        clearTimeout(timer);
        unsubscribe.then((stop) => stop()).catch(() => undefined);
        resolve(result);
      };
      const timer = setTimeout(() => done(blanked), 3000);
      // Both callers of done() run asynchronously, after this assignment.
      const unsubscribe = connection.subscribeMessage<{ result?: string }>(
        (message) => done(typeof message.result === 'string' ? { text: message.result, exact: true } : blanked),
        { type: 'render_template', template: content, report_errors: true },
      );
      unsubscribe.catch(() => done(blanked));
    });
  }

  private _emit(config: MermaidCardConfig): void {
    this._config = config;
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config }, bubbles: true, composed: true }));
  }

  private _formChanged(event: CustomEvent<{ value: Partial<MermaidCardConfig> }>): void {
    const value = event.detail.value;
    // A header typed or pasted into the content moves into the dropdowns.
    const { content, type, direction } = stripHeader(value.content ?? '');
    const config = {
      ...this._config,
      ...value,
      content,
      diagram_type: type ?? value.diagram_type ?? 'flowchart',
      direction: direction ?? value.direction,
    } as MermaidCardConfig;
    // A new type brings its example along, as long as nothing of the user's would be lost.
    const before = this._config ? this._formData(this._config) : undefined;
    if (before && !type && config.diagram_type !== before.diagram_type) {
      const untouched = !content.trim() || content === EXAMPLES[before.diagram_type as keyof typeof EXAMPLES];
      const example = EXAMPLES[config.diagram_type as keyof typeof EXAMPLES];
      if (untouched && example) config.content = example;
    }
    if (!config.title) delete config.title;
    // A direction only means something for a flowchart; it would linger unseen otherwise.
    if (!config.direction || config.direction === 'TB' || config.diagram_type !== 'flowchart') delete config.direction;
    if (config.diagram_type === 'flowchart') delete config.diagram_type; // the default
    if (config.scale === 100) delete config.scale; // the default
    this._emit(config);
  }

  private _rowsChanged(rows: Binding[]): void {
    this._rows = rows;
    const config = { ...this._config, entities: toMap(rows) } as MermaidCardConfig;
    if (!Object.keys(config.entities ?? {}).length) delete config.entities;
    this._emit(config);
  }

  private _addRow(): void {
    this._open = new Set([...this._open, this._rows.length]);
    this._rowsChanged([...this._rows, { node: '', entity: '' }]);
  }

  private _removeRow(index: number): void {
    // Rows after the removed one move up a place, their unfolded state with them.
    this._open = new Set([...this._open].filter((i) => i !== index).map((i) => (i > index ? i - 1 : i)));
    this._rowsChanged(this._rows.filter((_, i) => i !== index));
  }

  /** Fills in the matching entity when a node is picked for a row that has none yet. */
  private _suggest(old: Binding, row: Binding): Binding {
    // Only on a newly picked node: an entity the user cleared stays cleared.
    if (!row.node || row.node === old.node || row.entity || !this.hass) return row;
    const text = this._nodes.find((node) => node.id === row.node)?.text;
    return { ...row, entity: suggestEntity(row.node, text, this.hass.states) };
  }

  /** Appends a node showing the entity's name and state, and binds it, in one config change. */
  private _addNode(entityId: string | undefined): void {
    if (!entityId || !this._config) return;
    // A lowercase `end` closes a subgraph in Mermaid, so it cannot be a node id.
    const taken = new Set(['end', ...this._nodes.map((node) => node.id), ...this._rows.map((row) => row.node)]);
    const base = entityId.split('.')[1]?.replace(/\W/g, '') || 'node';
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}_${n}`;
    const name = (this.hass?.states[entityId]?.attributes.friendly_name || entityId)
      .replace(/"/g, '#quot;')
      .replace(/\{/g, '#123;'); // `{{` or `{%` in a name would be read as a template
    const line = `  ${id}["${name}<br>{{ states('${entityId}', with_unit=True) }}"]`;
    const content = this._config.content ?? '';
    this._rows = [...this._rows, { node: id, entity: entityId }];
    this._emit({
      ...this._config,
      content: content && !content.endsWith('\n') ? `${content}\n${line}` : `${content}${line}`,
      entities: toMap(this._rows),
    });
  }

  private _label = (schema: { name: string }) => localize(this.hass, `editor.${schema.name}`);
  // The entity picker draws its label above the field, which pushes it below the node field
  // beside it; it is self-explanatory with its own placeholder.
  private _rowLabel = (schema: { name: string }) => (schema.name === 'entity' ? '' : this._label(schema));
  private _helper = (schema: { name: string }) => {
    const text = localize(this.hass, `editor.${schema.name}_helper`);
    return text.startsWith('editor.') ? undefined : text;
  };

  protected render() {
    if (!this.hass || !this._config) return nothing;
    const used = new Set(this._rows.map((row) => row.node));
    // No ids means nothing to judge by: a type without bindable nodes, or text that did not parse.
    const known = this._nodes.length ? new Set(this._nodes.map((node) => node.id)) : undefined;
    const edges = new Set(this._nodes.filter((node) => node.edge).map((node) => node.id));
    const data = this._formData(this._config);
    const type = data.diagram_type;
    // A type the dropdown does not list (gitGraph, sankey, …) is still shown as it is.
    const types = [...DIAGRAM_TYPES, ...((DIAGRAM_TYPES as readonly string[]).includes(type) ? [] : [type])];
    return html`
      <ha-form
        .hass=${this.hass}
        .data=${data}
        .error=${this._parseError ? { content: this._parseError } : undefined}
        .schema=${[
          { name: 'title', selector: { text: {} } },
          {
            name: 'diagram_type',
            selector: {
              select: {
                mode: 'dropdown',
                options: types.map((value) => ({
                  value,
                  label: localize(this.hass, `editor.diagram_type_options.${value}`).replace(/^editor\..*/, value),
                })),
              },
            },
          },
          { name: 'content', required: true, selector: { template: {} } },
          // Mermaid only knows a direction for flowcharts.
          ...(type === 'flowchart' || !type
            ? [
                {
                  name: 'direction',
                  selector: {
                    select: {
                      mode: 'dropdown',
                      options: ['TB', 'BT', 'LR', 'RL'].map((value) => ({
                        value,
                        label: localize(this.hass, `editor.direction_options.${value}`),
                      })),
                    },
                  },
                },
              ]
            : []),
          {
            name: 'scale',
            selector: { number: { mode: 'slider', min: 30, max: 100, step: 10, unit_of_measurement: '%' } },
          },
        ]}
        .computeLabel=${this._label}
        .computeHelper=${this._helper}
        @value-changed=${this._formChanged}
      ></ha-form>

      <div class="bindings">
        <h3>${localize(this.hass, 'editor.bindings')}</h3>
        <p class="helper">${localize(this.hass, 'editor.bindings_helper')}</p>
        ${this._rows.map((row, index) => {
          const stateObj = row.entity ? this.hass!.states[row.entity] : undefined;
          const stale = known && row.node && !known.has(row.node);
          return html`
            <ha-expansion-panel
              outlined
              .expanded=${this._open.has(index)}
              .header=${row.node || localize(this.hass, 'editor.new_binding')}
            >
              ${
                stateObj
                  ? html`<ha-state-icon slot="leading-icon" .hass=${this.hass} .stateObj=${stateObj}></ha-state-icon>`
                  : nothing
              }
              <span slot="secondary" class=${stale ? 'stale' : ''}>
                ${stale ? localize(this.hass, 'editor.stale_binding') : (stateObj?.attributes.friendly_name ?? row.entity)}
              </span>
              <ha-icon-button
                slot="icons"
                .label=${localize(this.hass, 'editor.remove_binding')}
                .path=${MDI_DELETE}
                @click=${(event: Event) => {
                  event.stopPropagation(); // the header around it would fold the panel
                  this._removeRow(index);
                }}
              ></ha-icon-button>
              <ha-form
                .hass=${this.hass}
                .data=${row}
                .schema=${[
                  {
                    type: 'grid',
                    name: '',
                    schema: [
                      {
                        name: 'node',
                        selector: {
                          select: {
                            mode: 'dropdown',
                            custom_value: true,
                            // Each node once: a second binding would only overwrite the first.
                            options: this._nodes
                              .filter((candidate) => candidate.id === row.node || !used.has(candidate.id))
                              .map((candidate) => ({ value: candidate.id, label: candidate.label })),
                          },
                        },
                      },
                      { name: 'entity', selector: { entity: {} } },
                    ],
                  },
                  // Edges are not tappable, so actions on them would do nothing.
                  ...(edges.has(row.node)
                    ? []
                    : [
                        { name: 'tap_action', selector: { ui_action: { default_action: 'more-info' } } },
                        { name: 'hold_action', selector: { ui_action: { default_action: 'none' } } },
                      ]),
                ]}
                .computeLabel=${this._rowLabel}
                @value-changed=${(event: CustomEvent<{ value: Binding }>) =>
                  this._rowsChanged(
                    this._rows.map((old, i) =>
                      i === index ? this._suggest(old, { ...old, ...event.detail.value }) : old,
                    ),
                  )}
              ></ha-form>
            </ha-expansion-panel>
          `;
        })}
        <div class="add">
          <ha-button @click=${this._addRow}>${localize(this.hass, 'editor.add_binding')}</ha-button>
          ${
            type === 'flowchart'
              ? html`<ha-form
                  .hass=${this.hass}
                  .data=${{}}
                  .schema=${[{ name: 'add_node', selector: { entity: {} } }]}
                  .computeLabel=${this._label}
                  @value-changed=${(event: CustomEvent<{ value: { add_node?: string } }>) =>
                    this._addNode(event.detail.value.add_node)}
                ></ha-form>`
              : nothing
          }
        </div>
      </div>
    `;
  }

  static styles = css`
    ${unsafeCSS(editorStyles)}
  `;
}

if (!customElements.get(EDITOR_ELEMENT_NAME)) customElements.define(EDITOR_ELEMENT_NAME, MermaidCardEditor);
