// Icons for Mermaid's icon shapes (`A@{ icon: "mdi:heat-pump" }`, architecture `service db(mdi:database)`),
// taken from Home Assistant instead of a bundled icon set: its ha-icon resolves `mdi:` and `hass:` from
// the icon database it already caches, and the `prefix:` sets of custom icon integrations.
import type { MermaidApi } from './mermaid';

interface Icon {
  body: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

const ICON = /\bicon\s*:\s*["']?([\w-]+:[\w-]+)/g;
const ARCHITECTURE_ICON = /^[ \t]*(?:service|group)[ \t]+[\w-]+[ \t]*\(([\w-]+:[\w-]+)\)/gm;
const LOOKUP_TIMEOUT = 2000;

const lookups = new Map<string, Promise<Icon | undefined>>();
// One pack per prefix that only ever grows: Mermaid replaces a pack on registration, and the cards of
// a dashboard render interleaved, so a pack holding only one card's icons would drop another's.
const packs = new Map<string, { prefix: string; icons: Record<string, Icon> }>();

/** The `prefix:name` icons a diagram uses. */
export function iconNames(text: string): string[] {
  return [...new Set([...text.matchAll(ICON), ...text.matchAll(ARCHITECTURE_ICON)].map((match) => match[1]))];
}

/**
 * Registers the icons the diagram uses with Mermaid, as far as Home Assistant knows them. An icon
 * it does not know is left out; Mermaid draws its placeholder there.
 */
export async function registerIcons(mermaid: MermaidApi, text: string): Promise<void> {
  const names = iconNames(text);
  if (!names.length || !mermaid.registerIconPacks || !customElements.get('ha-icon')) return;
  await Promise.all(
    names.map(async (name) => {
      if (!lookups.has(name)) lookups.set(name, lookUp(name));
      const icon = await lookups.get(name);
      if (!icon) return;
      const [prefix, id] = name.split(':');
      if (!packs.has(prefix)) packs.set(prefix, { prefix, icons: {} });
      packs.get(prefix)!.icons[id] = icon;
    }),
  );
  mermaid.registerIconPacks([...packs.values()].map((icons) => ({ name: icons.prefix, icons })));
}

type SvgIcon = HTMLElement & { path?: string; viewBox?: string };

/** Lets a hidden ha-icon resolve the name, then reads the path it draws. */
async function lookUp(name: string): Promise<Icon | undefined> {
  const element = document.createElement('ha-icon') as HTMLElement & {
    icon: string;
    updateComplete?: Promise<unknown>;
  };
  element.icon = name;
  element.style.display = 'none';
  document.body.append(element);
  try {
    await element.updateComplete;
    // shortcut: ha-icon gives no sign that it does not know a name, so a miss costs the timeout (once per name).
    for (let waited = 0; waited < LOOKUP_TIMEOUT; waited += 50) {
      const svg = element.shadowRoot?.querySelector<SvgIcon>('ha-svg-icon');
      if (!svg) return undefined; // a prefix ha-icon hands to a legacy iconset
      if (svg.path) {
        const [left, top, width, height] = (svg.viewBox || '0 0 24 24').split(/[\s,]+/).map(Number);
        // Mermaid colours an icon through `color`: the node's stroke, or the theme's node border.
        return { body: `<path fill="currentColor" d="${svg.path}"/>`, left, top, width, height };
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return undefined;
  } finally {
    element.remove();
  }
}
