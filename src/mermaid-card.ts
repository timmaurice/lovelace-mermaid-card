import { LitElement, PropertyValues, css, html, nothing, unsafeCSS } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { bindNodes, toBinding } from './entities';
import { loadMermaid } from './mermaid';
import { EDITOR_ELEMENT_NAME } from './editor';
import { EXAMPLES, diagramType, withHeader } from './header';
import { localize } from './localize';
import cardStyles from './styles/card.styles.scss';
import { DIRECTIONS, TEMPLATE, type HomeAssistant, type MermaidCardConfig } from './types';

const ELEMENT_NAME = 'mermaid-card';
let renderCount = 0;
const MDI_ARROW_EXPAND =
  'M10,21V19H6.41L10.91,14.5L9.5,13.09L5,17.59V14H3V21H10M14.5,10.91L19,6.41V10H21V3H14V5H17.59L13.09,9.5L14.5,10.91Z';
const MDI_CLOSE =
  'M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z';
// The first `flowchart`/`graph` header line, with its direction if it has one.
const FLOWCHART_HEADER = /^([ \t]*(?:flowchart|graph)(?:-elk)?)(?:[ \t]+(?:TB|TD|BT|RL|LR))?([ \t]*;?[ \t]*)$/m;

/** Sets a flowchart's direction; other diagram types are returned unchanged. */
export function applyDirection(text: string, direction?: string): string {
  return direction ? text.replace(FLOWCHART_HEADER, `$1 ${direction}$2`) : text;
}

// Below this fraction of its (scaled) natural size a diagram's text gets unreadable; it scrolls instead.
const MIN_SCALE = 0.75;

/**
 * Sizes Mermaid's SVG: at most `scale` percent of its natural width, shrinking to fit the card but
 * never below MIN_SCALE of that; beyond it the card scrolls sideways.
 */
export function sizeDiagram(svg: SVGSVGElement | null, scale = 100): void {
  const width = (Number(svg?.getAttribute('viewBox')?.split(/[\s,]+/)[2]) * scale) / 100;
  if (!svg || !(width > 0)) return;
  svg.style.maxWidth = `${Math.round(width)}px`; // replaces Mermaid's own, which is the natural width
  svg.style.minWidth = `${Math.round(width * MIN_SCALE)}px`;
}

// Home Assistant's named colours, with its defaults for themes that do not set them. All dark
// enough to carry white labels.
const PALETTE: [string, string][] = [
  ['--blue-color', '#2196f3'],
  ['--deep-orange-color', '#ff6f22'],
  ['--green-color', '#4caf50'],
  ['--purple-color', '#926bc7'],
  ['--red-color', '#f44336'],
  ['--teal-color', '#009688'],
  ['--pink-color', '#e91e63'],
  ['--indigo-color', '#3f51b5'],
];

type TemplateMessage = { result: string } | { error: string; level?: string };

export class MermaidCard extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private _config?: MermaidCardConfig;
  @state() private _text?: string;
  @state() private _error?: string;
  /** The card's width, tracked only to redraw Gantt charts, which Mermaid draws at a fixed width. */
  @state() private _width = 0;
  /** Whether the diagram is shown below its natural size or scrolls, which offers the enlarged view. */
  @state() private _shrunk = false;
  private _resizeObserver?: ResizeObserver;
  @query('.diagram') private _diagram?: HTMLDivElement;
  @query('dialog') private _dialog?: HTMLDialogElement;
  private _svg?: string;

  private _unsubscribe?: Promise<() => Promise<void>>;
  private _renderToken = 0;
  private _renderedKey?: string;

  public static getConfigElement(): HTMLElement {
    return document.createElement(EDITOR_ELEMENT_NAME);
  }

  public static getStubConfig(): Partial<MermaidCardConfig> {
    return { content: EXAMPLES.flowchart };
  }

  public setConfig(config: MermaidCardConfig): void {
    if (typeof config?.content !== 'string' || !config.content.trim()) {
      throw new Error('content is required: the Mermaid source of the diagram');
    }
    if (config.entities !== undefined && (typeof config.entities !== 'object' || Array.isArray(config.entities))) {
      throw new Error('entities must map Mermaid node ids to entity ids');
    }
    for (const value of Object.values(config.entities ?? {})) {
      if (typeof toBinding(value)?.entity !== 'string') {
        throw new Error('each entry of entities must be an entity id, or a mapping with an entity');
      }
    }
    if (config.direction !== undefined && !DIRECTIONS.includes(config.direction)) {
      throw new Error(`direction must be one of ${DIRECTIONS.join(', ')}`);
    }
    if (config.diagram_type !== undefined && typeof config.diagram_type !== 'string') {
      throw new Error('diagram_type must be a Mermaid diagram type, e.g. flowchart');
    }
    if (config.scale !== undefined && !(typeof config.scale === 'number' && config.scale > 0)) {
      throw new Error('scale must be a positive number, in percent');
    }
    this._unsubscribeTemplate();
    this._config = config;
    this._text = TEMPLATE.test(config.content) ? undefined : config.content;
    this._renderedKey = undefined;
  }

  /** Masonry-view height in units of about 50 px; 4 until a diagram has been drawn. */
  public getCardSize(): number {
    // The rendered box, not the viewBox: the SVG may be shrunk to fit the card or scaled.
    const height = this._diagram?.querySelector('svg')?.getBoundingClientRect().height;
    if (!height) return 4;
    return Math.max(1, Math.ceil(height / 50)) + (this._config?.title ? 1 : 0);
  }

  /**
   * Sections-view sizing. Diagrams are wide, so the card takes the whole section by default instead
   * of the grid's half, where a journey or timeline ends up scrolling. An instance method: hui-card
   * reads it off the element.
   */
  public getGridOptions() {
    return { columns: 'full', min_columns: 3, rows: 'auto', min_rows: 1 };
  }

  public connectedCallback(): void {
    super.connectedCallback();
    this._renderedKey = undefined; // the SVG is gone if Lit re-renders after a reconnect
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver ??= new ResizeObserver(([entry]) => {
        const width = Math.round(entry.contentRect.width);
        if (width > 0 && Math.abs(width - this._width) > 8) this._width = width;
        this._measure();
      });
      this._resizeObserver.observe(this);
    }
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    this._resizeObserver?.disconnect();
    this._unsubscribeTemplate();
  }

  protected updated(changed: PropertyValues<this>): void {
    if (!this._config || !this.hass) return;
    if (!this._unsubscribe && TEMPLATE.test(this._config.content)) this._subscribeTemplate();

    // A Gantt chart is drawn for one width; the first render often sees the card before its layout.
    const gantt =
      this._text !== undefined && diagramType(withHeader(this._text, this._config.diagram_type)) === 'gantt';
    const { themes, selectedTheme } = this.hass;
    const theme = `${selectedTheme?.theme ?? themes?.theme}/${themes?.darkMode}`; // colours come from the theme
    const key = `${theme}\n${this._text}${gantt ? `\n${this._width}` : ''}`;
    if (this._text !== undefined && key !== this._renderedKey) {
      this._renderedKey = key;
      void this._renderDiagram(this._text);
    } else if (changed.has('hass') && this._boundStatesChanged(changed.get('hass') as HomeAssistant | undefined)) {
      this._bind();
    }
  }

  private _subscribeTemplate(): void {
    const { hass, _config: config } = this;
    if (!hass || !config) return;
    this._unsubscribe = hass.connection.subscribeMessage<TemplateMessage>(
      (message) => {
        if ('error' in message) {
          if (message.level === 'ERROR') this._error = message.error;
          return;
        }
        this._error = undefined;
        this._text = String(message.result);
      },
      { type: 'render_template', template: config.content, report_errors: true },
    );
    this._unsubscribe.catch((error: Error) => {
      this._error = error.message;
      this._unsubscribe = undefined;
    });
  }

  private _unsubscribeTemplate(): void {
    this._unsubscribe?.then((unsubscribe) => unsubscribe()).catch(() => undefined);
    this._unsubscribe = undefined;
  }

  private async _renderDiagram(text: string): Promise<void> {
    const token = ++this._renderToken;
    try {
      const mermaid = await loadMermaid();
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict', // diagrams may come from templates or an AI, so labels stay inert
        suppressErrorRendering: true,
        theme: 'base',
        darkMode: Boolean(this.hass?.themes?.darkMode),
        themeVariables: this._themeVariables(),
      });
      const source = applyDirection(
        withHeader(text, this._config?.diagram_type, this._config?.direction),
        this._config?.direction,
      );
      const { svg, bindFunctions } = await mermaid.render(
        `${ELEMENT_NAME}-${++renderCount}`,
        this._withGanttWidth(source),
      );
      if (token !== this._renderToken) return; // a newer render overtook this one
      await this.updateComplete;
      if (!this._diagram) return;
      this._error = undefined;
      this._diagram.innerHTML = this._svg = svg;
      sizeDiagram(this._diagram.querySelector('svg'), this._config?.scale);
      bindFunctions?.(this._diagram);
      if (this._dialog?.open) this._fillDialog();
      this._bind();
      this._measure();
    } catch (error) {
      if (token !== this._renderToken) return;
      this._error = error instanceof Error ? error.message : String(error);
    }
  }

  /**
   * Gantt charts draw at a fixed width with small text; this one fills the card instead. Passed as
   * a directive in the diagram, not through initialize(): that config is global, and the cards of
   * a dashboard render interleaved, so one card's width would land on another's chart.
   */
  private _withGanttWidth(source: string): string {
    if (diagramType(source) !== 'gantt') return source;
    const width = Math.max((this._width || this._diagram?.clientWidth || 0) - 32, 320);
    const gantt = { useWidth: width, fontSize: 14, sectionFontSize: 14, barHeight: 24 };
    return `${source}\n%%{init: ${JSON.stringify({ gantt })}}%%`;
  }

  private _measure(): void {
    const svg = this._diagram?.querySelector('svg');
    // maxWidth is the natural width sizeDiagram set; a scrolling diagram sits at its smaller minWidth.
    // A few pixels short is not worth a bigger view: a Gantt chart is drawn to the card's width.
    this._shrunk = Boolean(svg && svg.getBoundingClientRect().width < parseFloat(svg.style.maxWidth) - 8);
  }

  private _enlarge(): void {
    this._fillDialog();
    this._bind();
    this._dialog?.showModal();
  }

  /** The same diagram at its natural width; the dialog scrolls both ways. */
  private _fillDialog(): void {
    const content = this._dialog?.querySelector('.enlarged');
    if (!content || !this._svg) return;
    content.innerHTML = this._svg;
    const svg = content.querySelector('svg');
    sizeDiagram(svg, this._config?.scale);
    if (svg) svg.style.minWidth = svg.style.maxWidth;
  }

  private _bind(): void {
    if (!this.hass || !this._config?.entities) return;
    // The render root covers the card's diagram and the enlarged copy in the dialog.
    bindNodes(this.renderRoot, this._config.entities, this.hass.states, (binding, action) => {
      this._dialog?.close(); // whatever the action opens must not end up behind the modal
      // Home Assistant runs the action, as for its own cards; a tap opens more-info by default.
      this.dispatchEvent(
        new CustomEvent('hass-action', {
          detail: { config: { tap_action: { action: 'more-info' }, ...binding }, action },
          bubbles: true,
          composed: true,
        }),
      );
    });
  }

  private _boundStatesChanged(oldHass?: HomeAssistant): boolean {
    const entities = Object.values(this._config?.entities ?? {}).map((value) => toBinding(value).entity);
    return entities.some((entityId) => oldHass?.states[entityId] !== this.hass?.states[entityId]);
  }

  /** Mermaid's "base" theme, recoloured with the active Home Assistant theme. */
  private _themeVariables(): Record<string, string> {
    const style = getComputedStyle(this);
    const read = (name: string) => style.getPropertyValue(name).trim();
    const vars: Record<string, string> = {
      background: read('--ha-card-background') || read('--card-background-color'),
      primaryColor: read('--secondary-background-color'),
      primaryBorderColor: read('--primary-color'),
      primaryTextColor: read('--primary-text-color'),
      textColor: read('--primary-text-color'),
      lineColor: read('--secondary-text-color'),
      secondaryColor: read('--primary-background-color'),
      tertiaryColor: read('--card-background-color'),
      noteBkgColor: read('--secondary-background-color'),
      noteTextColor: read('--primary-text-color'),
      noteBorderColor: read('--divider-color'),
      fontFamily: style.fontFamily,
      pieStrokeColor: read('--card-background-color'),
      pieOuterStrokeColor: read('--divider-color'),
      pieSectionTextColor: '#ffffff',
      pieTitleTextColor: read('--primary-text-color'),
      pieLegendTextColor: read('--primary-text-color'),
    };
    // Pie slices, mind map branches and timeline sections each take a colour of their own. Mermaid
    // derives them from primaryColor, which a card background makes near black; HA's palette instead.
    PALETTE.forEach(([name, fallback], index) => {
      const color = read(name) || fallback;
      vars[`pie${index + 1}`] = color;
      vars[`cScale${index}`] = color;
      vars[`cScaleLabel${index}`] = '#ffffff';
    });
    return Object.fromEntries(Object.entries(vars).filter(([, value]) => value));
  }

  protected render() {
    if (!this._config) return nothing;
    return html`
      <ha-card .header=${this._config.title}>
        ${this._error ? html`<ha-alert alert-type="error">${this._error}</ha-alert>` : nothing}
        <div class="diagram ${this._shrunk ? 'shrunk' : ''}"></div>
        ${
          this._shrunk
            ? html`<ha-icon-button
                class="enlarge"
                .label=${localize(this.hass, 'card.enlarge')}
                .path=${MDI_ARROW_EXPAND}
                @click=${this._enlarge}
              ></ha-icon-button>`
            : nothing
        }
      </ha-card>
      <dialog
        aria-label=${this._config.title ?? localize(this.hass, 'card.enlarged')}
        @click=${(event: Event) => event.target === this._dialog && this._dialog.close()}
        @close=${() => this._dialog?.querySelector('.enlarged')?.replaceChildren()}
      >
        <div class="enlarged"></div>
        <ha-icon-button
          class="close"
          .label=${localize(this.hass, 'card.close')}
          .path=${MDI_CLOSE}
          @click=${() => this._dialog?.close()}
        ></ha-icon-button>
      </dialog>
    `;
  }

  static styles = css`
    ${unsafeCSS(cardStyles)}
  `;
}

if (!customElements.get(ELEMENT_NAME)) {
  customElements.define(ELEMENT_NAME, MermaidCard);
  (window as unknown as { customCards?: unknown[] }).customCards ??= [];
  (window as unknown as { customCards: unknown[] }).customCards.push({
    type: ELEMENT_NAME,
    name: 'Mermaid Card',
    description: 'Mermaid diagrams with live Home Assistant states',
    preview: true,
  });
}
