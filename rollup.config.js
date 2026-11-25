import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { compile } from 'sass';
import litCss from 'rollup-plugin-lit-css';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import nodeResolve from '@rollup/plugin-node-resolve';
import json from '@rollup/plugin-json';
import commonjs from '@rollup/plugin-commonjs';
import { rollup } from 'rollup';

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
// file. Mermaid's code is megabytes; parsing and running it on each page load would slow down
// dashboards that never show a diagram. So it travels inside the card as a string — cheap to
// parse — and is only executed when the first diagram renders (see mermaid.ts).
// Mermaid 13 ships as an ESM entry plus per-diagram chunks that import each other, and no longer
// bundles ELK. A nested Rollup pass flattens Mermaid and ELK into one classic script that sets
// `globalThis.mermaid`, the shape the 12 IIFE had.
const MERMAID_SOURCE_ID = 'virtual:mermaid-source';
const MERMAID_ENTRY_ID = '\0mermaid-entry';
const MERMAID_ENTRY = `import mermaid from 'mermaid';
import elkLayouts from '@mermaid-js/layout-elk';
import { icons } from '@mermaid-js/plugin-icons';
mermaid.registerLayoutLoaders(elkLayouts);
// Without this extension 13 draws every registered icon as its "?" placeholder. Not awaited: it
// settles in microtasks, before the script's onload hands Mermaid to the card.
mermaid.registerExternalDiagrams([icons]);
export default mermaid;`;

async function buildMermaid() {
  const bundle = await rollup({
    input: MERMAID_ENTRY_ID,
    onwarn: (warning, warn) => !['CIRCULAR_DEPENDENCY', 'THIS_IS_UNDEFINED'].includes(warning.code) && warn(warning),
    plugins: [
      {
        name: 'mermaid-entry',
        resolveId: (id) => (id === MERMAID_ENTRY_ID ? id : null),
        load: (id) => (id === MERMAID_ENTRY_ID ? MERMAID_ENTRY : null),
      },
      nodeResolve({ browser: true }),
      commonjs(), // elkjs
    ],
  });
  const { output } = await bundle.generate({
    format: 'iife',
    name: 'mermaid',
    exports: 'default',
    inlineDynamicImports: true,
    plugins: [terser({ format: { comments: false } })],
  });
  await bundle.close();
  return { code: output[0].code, files: bundle.watchFiles };
}

function mermaidSourcePlugin() {
  return {
    name: 'mermaid-source',
    resolveId: (id) => (id === MERMAID_SOURCE_ID ? `\0${MERMAID_SOURCE_ID}` : null),
    async load(id) {
      if (id !== `\0${MERMAID_SOURCE_ID}`) return null;
      const { code, files } = await buildMermaid();
      files.forEach((file) => this.addWatchFile(file));
      return `export default ${JSON.stringify(code)};`;
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
