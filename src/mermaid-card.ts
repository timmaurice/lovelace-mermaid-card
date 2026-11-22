import { LitElement, PropertyValues, css, html, nothing, unsafeCSS } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { START, automationFlowchart, type AutomationTrace } from './automation';
import { bindNodes, toBinding } from './entities';
import { registerIcons } from './icons';
import { loadMermaid } from './mermaid';
import { EDITOR_ELEMENT_NAME } from './editor';
import { EXAMPLES, diagramType, withHeader } from './header';
import { localize } from './localize';
import { attachZoom } from './zoom';
import cardStyles from './styles/card.styles.scss';
import { DIRECTIONS, TEMPLATE, type HomeAssistant, type MermaidCardConfig } from './types';

const ELEMENT_NAME = 'mermaid-card';
let renderCount = 0;
const MDI_ARROW_EXPAND =
  'M10,21V19H6.41L10.91,14.5L9.5,13.09L5,17.59V14H3V21H10M14.5,10.91L19,6.41V10H21V3H14V5H17.59L13.09,9.5L14.5,10.91Z';
const MDI_CLOSE =
  'M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z';
const MDI_PLUS = 'M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z';
const MDI_MINUS = 'M19,13H5V11H19V13Z';
const MDI_FULLSCREEN_EXIT = 'M14,14H19V16H16V19H14V14M5,14H10V19H8V16H5V14M8,5H10V10H5V8H8V5M19,8V10H14V5H16V8H19Z';
// Zoom in the enlarged view goes up to this many times the diagram's natural size.
const MAX_ZOOM = 4;
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

// Room left around the drawing when empty space is cropped from Mermaid's viewBox.
const CROP_MARGIN = 8;

/**
 * Crops empty space from Mermaid's viewBox: a journey, timeline, pie or sequence diagram leaves
 * room around its drawing that only makes the text smaller once the diagram is fitted to the card.
 * Only when the drawing lies wholly inside the box, so nothing is cut off: a Gantt chart's grid
 * reaches past it.
 */
export function cropDiagram(svg: SVGSVGElement | null): void {
  const [x, y, width, height] =
    svg
      ?.getAttribute('viewBox')
      ?.split(/[\s,]+/)
      .map(Number) ?? [];
  let box: DOMRect | undefined;
  try {
    box = svg?.getBBox?.();
  } catch {
    return; // Firefox throws for an SVG that is not shown
  }
  if (!svg || !box || !(box.width > 0) || ![x, y, width, height].every(Number.isFinite)) return;
  if (box.x < x || box.y < y || box.x + box.width > x + width || box.y + box.height > y + height) return;
  // The margin never reaches past Mermaid's own box: a drawing close to its edge keeps that edge.
  const [left, top] = [Math.max(x, box.x - CROP_MARGIN), Math.max(y, box.y - CROP_MARGIN)];
  const right = Math.min(x + width, box.x + box.width + CROP_MARGIN);
  const bottom = Math.min(y + height, box.y + box.height + CROP_MARGIN);
  svg.setAttribute('viewBox', `${left} ${top} ${right - left} ${bottom - top}`);
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

type TraceSummary = { run_id: string; timestamp: { start: string } };
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
  private _zoom?: ReturnType<typeof attachZoom>;

  private _unsubscribe?: Promise<() => Promise<void>>;
  private _renderToken = 0;
  private _renderedKey?: string;
  private _automationKey?: string;

  public static getConfigElement(): HTMLElement {
    return document.createElement(EDITOR_ELEMENT_NAME);
  }

  public static getStubConfig(): Partial<MermaidCardConfig> {
    return { content: EXAMPLES.flowchart };
  }

  public setConfig(config: MermaidCardConfig): void {
    if (config?.automation !== undefined) {
      if (typeof config.automation !== 'string' || !config.automation.startsWith('automation.')) {
        throw new Error('automation must be an automation entity id, e.g. automation.hall_light');
      }
    } else if (typeof config?.content !== 'string' || !config.content.trim()) {
      throw new Error('content is required: the Mermaid source of the diagram');
    }
    if (config.entities !== undefined && (typeof config.entities !== 'object' || Array.isArray(config.entities))) {
      throw new Error('entities must map Mermaid node ids to entity ids');
    }
    for (const value of Object.values(config.entities ?? {})) {
      const binding = toBinding(value);
      if (typeof binding?.entity !== 'string') {
        throw new Error('each entry of entities must be an entity id, or a mapping with an entity');
      }
      const activeWhen = binding.active_when;
      if (activeWhen !== undefined && ![activeWhen].flat().every((state) => typeof state === 'string')) {
        throw new Error('active_when must be a state or a list of states, numbers in quotes');
      }
      if (binding.speed !== undefined && binding.speed !== 'auto') throw new Error('speed must be auto');
      if (binding.max !== undefined && !(typeof binding.max === 'number' && binding.max > 0)) {
        throw new Error('max must be a positive number, the value at full speed');
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
    // A tap on the start node opens the automation's more-info, with its traces and "Run actions".
    this._config = config.automation
      ? { ...config, entities: { [START]: config.automation, ...config.entities } }
      : config;
    this._text = config.automation || TEMPLATE.test(config.content!) ? undefined : config.content;
    this._renderedKey = this._automationKey = undefined;
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
    if (this._config.automation) void this._watchAutomation(this._config.automation);
    else if (!this._unsubscribe && TEMPLATE.test(this._config.content!)) this._subscribeTemplate();

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

  /** Draws the automation again whenever it has run since, or finished a run. */
  private async _watchAutomation(entityId: string): Promise<void> {
    const { hass } = this;
    const entity = hass?.states[entityId];
    // `current` counts running instances: a run that waits (delay) is drawn again when it ends.
    const key = `${entityId}/${entity?.attributes.last_triggered}/${entity?.attributes.current}`;
    if (!hass || key === this._automationKey) return;
    this._automationKey = key;
    const send = <T>(message: Record<string, unknown>) => hass.connection.sendMessagePromise<T>(message);
    try {
      const { config } = await send<{ config: Record<string, unknown> }>({
        type: 'automation/config',
        entity_id: entityId,
      });
      // Traces are keyed by the automation's own id; one without an id keeps none.
      const id = entity?.attributes.id;
      let trace: AutomationTrace | undefined;
      try {
        const runs = id ? await send<TraceSummary[]>({ type: 'trace/list', domain: 'automation', item_id: id }) : [];
        const last = runs.sort((a, b) => a.timestamp.start.localeCompare(b.timestamp.start)).at(-1);
        if (last) trace = await send({ type: 'trace/get', domain: 'automation', item_id: id, run_id: last.run_id });
      } catch {
        // without a trace, the automation is still drawn
      }
      if (key !== this._automationKey) return; // it ran again meanwhile
      this._text = automationFlowchart(
        config,
        trace,
        (entity) => hass.states[entity]?.attributes.friendly_name ?? entity,
      );
    } catch (error) {
      this._error = (error as { message?: string })?.message ?? String(error); // HA rejects with { code, message }
    }
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
        // Mermaid's themes read darkMode from the theme variables, not from the top level.
        themeVariables: { ...this._themeVariables(), darkMode: Boolean(this.hass?.themes?.darkMode) },
      });
      const source = applyDirection(
        withHeader(text, this._config?.diagram_type, this._config?.direction),
        this._config?.direction,
      );
      await registerIcons(mermaid, source);
      const { svg, bindFunctions } = await mermaid.render(
        `${ELEMENT_NAME}-${++renderCount}`,
        this._withGanttWidth(source),
      );
      if (token !== this._renderToken) return; // a newer render overtook this one
      await this.updateComplete;
      if (!this._diagram) return;
      this._error = undefined;
      this._diagram.innerHTML = this._svg = svg;
      cropDiagram(this._diagram.querySelector('svg'));
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
    this._zoom?.reset();
    this._bind();
    this._dialog?.showModal();
  }

  /** The same diagram, at most at its natural width and fitted to the screen; zoom shows the rest. */
  private _fillDialog(): void {
    const content = this._dialog?.querySelector<HTMLElement>('.zoom');
    if (!this._dialog || !content || !this._svg) return;
    content.innerHTML = this._svg;
    const svg = content.querySelector('svg');
    const cropped = this._diagram?.querySelector('svg')?.getAttribute('viewBox');
    if (svg && cropped) svg.setAttribute('viewBox', cropped); // the closed dialog has no layout to crop by
    sizeDiagram(svg, this._config?.scale);
    const [, , width, height] =
      svg
        ?.getAttribute('viewBox')
        ?.split(/[\s,]+/)
        .map(Number) ?? [];
    const natural = parseFloat(svg?.style.maxWidth ?? '');
    this._zoom ??= attachZoom(content, this._dialog);
    if (!svg || !(natural > 0)) return;
    // The largest dialog the screen allows, less its margin and the padding around the diagram.
    const fit = Math.min(1, (innerWidth - 64) / natural, ((innerHeight - 96) * width) / (natural * height) || 1);
    svg.style.width = svg.style.minWidth = svg.style.maxWidth = `${Math.floor(natural * fit)}px`;
    this._zoom.max = MAX_ZOOM / fit;
    this._zoom.apply();
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
  private _themeVariables(): Record<string, string | Record<string, string>> {
    const style = getComputedStyle(this);
    const read = (name: string) => style.getPropertyValue(name).trim();
    const vars: Record<string, string> = {
      background: read('--ha-card-background') || read('--card-background-color'),
      // Edge and icon labels sit on the card; Mermaid would make them black in dark mode.
      edgeLabelBackground: read('--ha-card-background') || read('--card-background-color'),
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
    const colors = PALETTE.map(([name, fallback]) => read(name) || fallback);
    // Pies and colour scales go up to 12; past the palette's 8 they start over instead of black.
    for (let index = 0; index < 12; index++) {
      vars[`pie${index + 1}`] = vars[`cScale${index}`] = colors[index % colors.length];
      vars[`cScaleLabel${index}`] = '#ffffff';
    }
    colors.forEach((color, index) => {
      // git0 is also the mind map's root, gitBranchLabel0 its text.
      vars[`git${index}`] = color;
      vars[`gitBranchLabel${index}`] = '#ffffff';
      vars[`fillType${index}`] = color; // user journey sections
    });
    const xyChart = { plotColorPalette: colors.join(',') }; // its own default is pale pastels
    return { ...Object.fromEntries(Object.entries(vars).filter(([, value]) => value)), xyChart };
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
        tabindex="-1"
        aria-label=${this._config.title ?? localize(this.hass, 'card.enlarged')}
        @click=${(event: Event) => event.target === this._dialog && this._dialog.close()}
        @close=${() => this._dialog?.querySelector('.zoom')?.replaceChildren()}
      >
        <div class="enlarged"><div class="zoom"></div></div>
        <div class="tools">
          <ha-icon-button
            .label=${localize(this.hass, 'card.zoom_out')}
            .path=${MDI_MINUS}
            @click=${() => this._zoom?.zoom(0.8)}
          ></ha-icon-button>
          <ha-icon-button
            .label=${localize(this.hass, 'card.zoom_in')}
            .path=${MDI_PLUS}
            @click=${() => this._zoom?.zoom(1.25)}
          ></ha-icon-button>
          <ha-icon-button
            .label=${localize(this.hass, 'card.zoom_reset')}
            .path=${MDI_FULLSCREEN_EXIT}
            @click=${() => this._zoom?.reset()}
          ></ha-icon-button>
          <ha-icon-button
            .label=${localize(this.hass, 'card.close')}
            .path=${MDI_CLOSE}
            @click=${() => this._dialog?.close()}
          ></ha-icon-button>
        </div>
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
