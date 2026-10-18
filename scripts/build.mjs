/**
 * Bundles the extension into `dist/`.
 *
 * esbuild produces one self-contained IIFE. Everything the page needs —
 * including the Azure DevOps Extension SDK — is bundled locally, so the
 * published extension loads no script from any CDN or external origin.
 */
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist');
const staticDir = join(root, 'static');

const dev = process.argv.includes('--dev');
const watch = process.argv.includes('--watch');

await mkdir(outDir, { recursive: true });

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: [join(root, 'src/main.ts')],
  outfile: join(outDir, 'heatmap.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  minify: !dev,
  sourcemap: dev ? 'inline' : false,
  legalComments: 'none',
  logLevel: 'info',
  // Fail the build rather than silently emitting a bundle that reaches out.
  external: [],
};

async function copyStatic() {
  for (const name of await readdir(staticDir)) {
    await copyFile(join(staticDir, name), join(outDir, name));
  }
}

if (watch) {
  const context = await esbuild.context(options);
  await context.watch();
  await copyStatic();
  console.log('Watching for changes. Press Ctrl+C to stop.');
} else {
  await esbuild.build(options);
  await copyStatic();
  console.log(`Built dist/ (${dev ? 'development' : 'production'})`);
}
