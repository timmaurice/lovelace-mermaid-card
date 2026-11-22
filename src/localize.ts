import de from './translation/de.json';
import en from './translation/en.json';

interface TranslationObject {
  [key: string]: string | TranslationObject;
}

const translations: Record<string, TranslationObject> = { de, en };

function lookup(language: string, keys: string[]): string | undefined {
  let node: string | TranslationObject | undefined = translations[language];
  for (const key of keys) {
    if (typeof node !== 'object') return undefined;
    node = node[key];
  }
  return typeof node === 'string' ? node : undefined;
}

/** The text for `key` in the user's language, falling back to English, then to the key itself. */
export function localize(hass: { language?: string } | undefined, key: string): string {
  const keys = key.split('.');
  const language = hass?.language?.split('-')[0] ?? 'en';
  return lookup(language, keys) ?? lookup('en', keys) ?? key;
}
