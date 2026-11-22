import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { compile } from 'sass';
import litCss from 'rollup-plugin-lit-css';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import nodeResolve from '@rollup/plugin-node-resolve';
import json from '@rollup/plugin-json';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));
const dev = process.env.ROLLUP_WATCH === 'true';

function logCardInfo() {
  const part1 = `🧜 ${pkg.name.toUpperCase().replace(/-/g, ' ')}`;
  const part2 = `v${pkg.version}`;
  const part1Style =
    'color: orange; font-weight: bold; background: black; padding: 2px 4px; border-radius: 2px 0 0 2px;';
  const part2Style =
    'color: white; font-weight: bold; background: dimgray; padding: 2px 4px; border-radius: 0 2px 2px 0;';
  return `
    console.groupCollapsed('%c${part1}%c${part2}', '${part1Style}', '${part2Style}');
    console.info("${pkg.description}");
    console.info('Github:  ${pkg.repository.url}');
    console.info('Sponsor: https://buymeacoffee.com/timmaurice');
    console.groupEnd();
  `;
}

// Home Assistant loads every dashboard resource on every dashboard, and HACS ships a card as one
// file. Mermaid's self-contained build is ~5.5 MB of code; parsing and running it on each page
// load would slow down dashboards that never show a diagram. So it travels inside the card as a
// string — cheap to parse — and is only executed when the first diagram renders (see mermaid.ts).
const MERMAID_BUILD = 'node_modules/mermaid/dist/mermaid.min.js';
const MERMAID_SOURCE_ID = 'virtual:mermaid-source';

function mermaidSourcePlugin() {
  return {
    name: 'mermaid-source',
    resolveId: (id) => (id === MERMAID_SOURCE_ID ? `\0${MERMAID_SOURCE_ID}` : null),
    load(id) {
      if (id !== `\0${MERMAID_SOURCE_ID}`) return null;
      this.addWatchFile(MERMAID_BUILD);
      return `export default ${JSON.stringify(readFileSync(MERMAID_BUILD, 'utf-8'))};`;
    },
  };
}

export default {
  input: 'src/mermaid-card.ts',
  output: {
    file: pkg.main,
    format: 'es',
    sourcemap: dev,
    banner: logCardInfo(),
    inlineDynamicImports: true,
  },
  plugins: [
    mermaidSourcePlugin(),
    nodeResolve(),
    litCss({
      include: ['**/*.scss'],
      transform: (data, { filePath }) =>
        compile(filePath, { style: dev ? 'expanded' : 'compressed', loadPaths: [path.dirname(filePath)] }).css,
    }),
    json({ compact: true }),
    typescript({ sourceMap: dev, inlineSources: dev }),
    !dev && terser({ format: { comments: false } }),
  ],
};
