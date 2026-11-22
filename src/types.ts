export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: { friendly_name?: string; [key: string]: unknown };
}

export interface HomeAssistant {
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
  direction?: 'TB' | 'TD' | 'BT' | 'LR' | 'RL';
}
