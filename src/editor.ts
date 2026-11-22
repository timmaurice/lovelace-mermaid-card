import { LitElement, css, html, nothing } from 'lit';
import { property, state } from 'lit/decorators.js';
import { DIAGRAM_TYPES, EXAMPLES, stripHeader, withHeader } from './header';
import { localize } from './localize';
import { DiagramNode, listNodes } from './mermaid';
import { toBinding } from './entities';
import type { HomeAssistant, MermaidCardConfig, NodeBinding } from './types';

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

export class MermaidCardEditor extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private _config?: MermaidCardConfig;
  /** Rows as shown, including half-filled ones the config cannot hold yet. */
  @state() private _rows: Binding[] = [];
  @state() private _nodes: DiagramNode[] = [];
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
      const nodes = await listNodes(await this._renderOnce(content));
      if (content === this._nodesFor) this._nodes = nodes;
    }, 400);
  }

  /**
   * The content as the card will see it. Templates can hide Mermaid syntax — a hexagon `{{text}}`
   * is written `{{ '{{' }}text{{ '}}' }}` — so they are rendered by Home Assistant before parsing.
   * Without Home Assistant, or when rendering fails, the templates are blanked out instead; the
   * ids usually survive that.
   */
  private async _renderOnce(content: string): Promise<string> {
    if (!/\{\{|\{%/.test(content)) return content;
    const blanked = content.replace(/\{\{[\s\S]*?\}\}/g, '…').replace(/\{%[\s\S]*?%\}/g, '');
    const connection = this.hass?.connection;
    if (!connection) return blanked;
    return new Promise<string>((resolve) => {
      const done = (text: string) => {
        clearTimeout(timer);
        unsubscribe.then((stop) => stop()).catch(() => undefined);
        resolve(text);
      };
      const timer = setTimeout(() => done(blanked), 3000);
      // Both callers of done() run asynchronously, after this assignment.
      const unsubscribe = connection.subscribeMessage<{ result?: string }>(
        (message) => done(typeof message.result === 'string' ? message.result : blanked),
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
    const data = this._formData(this._config);
    const type = data.diagram_type;
    // A type the dropdown does not list (gitGraph, sankey, …) is still shown as it is.
    const types = [...DIAGRAM_TYPES, ...((DIAGRAM_TYPES as readonly string[]).includes(type) ? [] : [type])];
    return html`
      <ha-form
        .hass=${this.hass}
        .data=${data}
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
        ${this._rows.map(
          (row, index) => html`
            <div class="row">
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
                              .filter((node) => node.id === row.node || !used.has(node.id))
                              .map((node) => ({ value: node.id, label: node.label })),
                          },
                        },
                      },
                      { name: 'entity', selector: { entity: {} } },
                    ],
                  },
                  {
                    type: 'expandable',
                    name: 'actions',
                    flatten: true,
                    schema: [
                      { name: 'tap_action', selector: { ui_action: { default_action: 'more-info' } } },
                      { name: 'hold_action', selector: { ui_action: { default_action: 'none' } } },
                    ],
                  },
                ]}
                .computeLabel=${this._rowLabel}
                @value-changed=${(event: CustomEvent<{ value: Binding }>) =>
                  this._rowsChanged(
                    this._rows.map((old, i) => (i === index ? { ...old, ...event.detail.value } : old)),
                  )}
              ></ha-form>
              <ha-icon-button
                .label=${localize(this.hass, 'editor.remove_binding')}
                .path=${MDI_DELETE}
                @click=${() => this._rowsChanged(this._rows.filter((_, i) => i !== index))}
              ></ha-icon-button>
            </div>
          `,
        )}
        <ha-button @click=${() => this._rowsChanged([...this._rows, { node: '', entity: '' }])}>
          ${localize(this.hass, 'editor.add_binding')}
        </ha-button>
      </div>
    `;
  }

  static styles = css`
    .bindings {
      margin-top: 24px;
    }
    h3 {
      margin: 0 0 4px;
      font-size: 1rem;
      font-weight: 500;
    }
    .helper {
      margin: 0 0 12px;
      color: var(--secondary-text-color);
      font-size: 0.875rem;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .row ha-form {
      flex: 1;
    }
  `;
}

if (!customElements.get(EDITOR_ELEMENT_NAME)) customElements.define(EDITOR_ELEMENT_NAME, MermaidCardEditor);
