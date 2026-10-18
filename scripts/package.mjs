/**
 * Packages `dist/` into an installable .vsix using the official tfx-cli.
 *
 * Pass `--publisher <id>` (or set VSIX_PUBLISHER) to stamp your own Marketplace
 * publisher without editing the manifest.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

if (!existsSync(join(root, 'dist', 'heatmap.html'))) {
  console.error('dist/ is missing or incomplete. Run `npm run build` first.');
  process.exit(1);
}

const argv = process.argv.slice(2);
const publisherIndex = argv.indexOf('--publisher');
const publisher =
  publisherIndex >= 0 ? argv[publisherIndex + 1] : process.env.VSIX_PUBLISHER;

const args = [
  'extension',
  'create',
  '--manifest-globs',
  'vss-extension.json',
  '--output-path',
  root,
  '--no-color',
];

if (publisher) {
  args.push('--publisher', publisher);
}
if (argv.includes('--dev')) {
  // A distinct id/version keeps a dev build from colliding with a shared one.
  args.push('--rev-version');
}

const tfx = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tfx.cmd' : 'tfx');
const result = spawnSync(tfx, args, { cwd: root, stdio: 'inherit' });

if (result.error) {
  console.error('Could not run tfx-cli:', result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
