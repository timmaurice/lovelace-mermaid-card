import { LitElement, PropertyValues, css, html, nothing } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { bindNodes } from './entities';
import { loadMermaid } from './mermaid';
import { EDITOR_ELEMENT_NAME } from './editor';
import { EXAMPLES, withHeader } from './header';
import { DIRECTIONS, type HomeAssistant, type MermaidCardConfig } from './types';

const ELEMENT_NAME = 'mermaid-card';
const TEMPLATE = /\{\{|\{%/;
let renderCount = 0;
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
  @query('.diagram') private _diagram?: HTMLDivElement;

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

  public getCardSize(): number {
    return 4;
  }

  public connectedCallback(): void {
    super.connectedCallback();
    this._renderedKey = undefined; // the SVG is gone if Lit re-renders after a reconnect
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    this._unsubscribeTemplate();
  }

  protected updated(changed: PropertyValues<this>): void {
    if (!this._config || !this.hass) return;
    if (!this._unsubscribe && TEMPLATE.test(this._config.content)) this._subscribeTemplate();

    const key = `${this.hass.themes?.darkMode}\n${this._text}`;
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
        // Gantt charts draw at a fixed width with small text; this one fills the card instead.
        gantt: {
          useWidth: Math.max((this._diagram?.clientWidth ?? 0) - 32, 320),
          fontSize: 14,
          sectionFontSize: 14,
          barHeight: 24,
        },
      });
      const { svg, bindFunctions } = await mermaid.render(
        `${ELEMENT_NAME}-${++renderCount}`,
        applyDirection(withHeader(text, this._config?.diagram_type, this._config?.direction), this._config?.direction),
      );
      if (token !== this._renderToken) return; // a newer render overtook this one
      await this.updateComplete;
      if (!this._diagram) return;
      this._error = undefined;
      this._diagram.innerHTML = svg;
      sizeDiagram(this._diagram.querySelector('svg'), this._config?.scale);
      bindFunctions?.(this._diagram);
      this._bind();
    } catch (error) {
      if (token !== this._renderToken) return;
      this._error = error instanceof Error ? error.message : String(error);
    }
  }

  private _bind(): void {
    if (!this._diagram || !this.hass || !this._config?.entities) return;
    bindNodes(this._diagram, this._config.entities, this.hass.states, (entityId) =>
      this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId }, bubbles: true, composed: true })),
    );
  }

  private _boundStatesChanged(oldHass?: HomeAssistant): boolean {
    const entities = Object.values(this._config?.entities ?? {});
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
        <div class="diagram"></div>
      </ha-card>
    `;
  }

  static styles = css`
    ha-card {
      overflow: hidden;
    }
    ha-alert {
      display: block;
      margin: 0 16px 16px;
    }
    .diagram {
      padding: 16px;
      overflow-x: auto;
    }
    ha-card[header] .diagram {
      padding-top: 0;
    }
    .diagram svg {
      display: block;
      margin: 0 auto; /* not flex centring: that would cut off the left edge once it scrolls */
      max-width: 100%;
      height: auto;
    }
    .diagram .node[role='button']:focus-visible {
      outline: 2px solid var(--primary-color);
    }
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
