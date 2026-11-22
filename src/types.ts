export const DIRECTIONS = ['TB', 'TD', 'BT', 'LR', 'RL'] as const;

/**
 * Content Home Assistant must render first: an expression, a statement or a Jinja comment. A
 * comment counts only when closed, so a rhombus like `A{#1 choice}` stays plain Mermaid.
 */
export const TEMPLATE = /\{\{|\{%|\{#[\s\S]*?#\}/;

export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: { friendly_name?: string; [key: string]: unknown };
}

export interface HomeAssistant {
  language?: string;
  states: Record<string, HassEntity>;
  themes: { darkMode: boolean; theme?: string };
  /** The user's own theme choice, which overrides themes.theme. */
  selectedTheme?: { theme?: string } | null;
  connection: {
    subscribeMessage<T>(callback: (message: T) => void, params: Record<string, unknown>): Promise<() => Promise<void>>;
    sendMessagePromise<T>(message: Record<string, unknown>): Promise<T>;
  };
}

/** A Home Assistant action (tap_action format), passed on to Home Assistant as it is. */
export type ActionConfig = { action: string; [key: string]: unknown };

/** A node bound to an entity, with the actions a tap or a long press runs. */
export interface NodeBinding {
  entity: string;
  /** The state, or states, in which the node counts as active; any active state without it. */
  active_when?: string | string[];
  tap_action?: ActionConfig;
  hold_action?: ActionConfig;
  /** Edges only: `auto` moves the edge faster the higher its entity's value. */
  speed?: 'auto';
  /** With `speed: auto`, the value (absolute) at full speed. Default 10000. */
  max?: number;
}

export interface MermaidCardConfig {
  type: string;
  title?: string;
  /** Mermaid source; may contain Home Assistant templates. Its first line may name the type. */
  content?: string;
  /** Instead of content: an automation entity, drawn with the path of its last run. */
  automation?: string;
  /** Mermaid diagram type, used when the content has no header line of its own. Default flowchart. */
  diagram_type?: string;
  /**
   * Mermaid node or edge id → entity id, or a binding with actions. Bound nodes are coloured by
   * state and open more-info; bound edges animate while their entity is active.
   */
  entities?: Record<string, string | NodeBinding>;
  /** Overrides a flowchart's direction, e.g. TD for a narrow card. */
  direction?: (typeof DIRECTIONS)[number];
  /** Size in percent of the diagram's natural size; 100 (default) fits it to the card. */
  scale?: number;
}
