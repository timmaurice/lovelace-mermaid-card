export const DIRECTIONS = ['TB', 'TD', 'BT', 'LR', 'RL'] as const;

export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: { friendly_name?: string; [key: string]: unknown };
}

export interface HomeAssistant {
  language?: string;
  states: Record<string, HassEntity>;
  themes: { darkMode: boolean };
  connection: {
    subscribeMessage<T>(callback: (message: T) => void, params: Record<string, unknown>): Promise<() => Promise<void>>;
  };
}

export interface MermaidCardConfig {
  type: string;
  title?: string;
  /** Mermaid source; may contain Home Assistant templates. */
  content: string;
  /** Mermaid node id → entity id. Bound nodes are coloured by state and open more-info. */
  entities?: Record<string, string>;
  /** Overrides a flowchart's direction, e.g. TD for a narrow card. */
  direction?: (typeof DIRECTIONS)[number];
  /** Size in percent of the diagram's natural size; 100 (default) fits it to the card. */
  scale?: number;
}
