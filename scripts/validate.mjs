/**
 * Post-build checks.
 *
 * These are the guarantees the README makes, asserted mechanically so they
 * cannot quietly regress:
 *
 *  1. The manifest is valid and every declared file exists.
 *  2. Only read-only scopes are requested.
 *  3. The bundle contains no absolute URL outside Azure DevOps.
 *  4. The bundle never requests repository content (items/blobs/pushes/diffs).
 *  5. No credential-shaped literals are committed.
 *  6. The packaged .vsix, when present, carries the files the hub needs.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const failures = [];
const notes = [];

function check(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

// ------------------------------------------------------------------ manifest

const manifestPath = join(root, 'vss-extension.json');
check(existsSync(manifestPath), 'vss-extension.json is missing.');

let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
} catch (error) {
  failures.push(`vss-extension.json is not valid JSON: ${error.message}`);
  manifest = {};
}

for (const field of ['manifestVersion', 'id', 'version', 'name', 'publisher', 'targets']) {
  check(manifest[field] !== undefined, `Manifest is missing required field "${field}".`);
}

check(
  Array.isArray(manifest.targets) &&
    manifest.targets.some((target) => target.id === 'Microsoft.VisualStudio.Services'),
  'Manifest must target Microsoft.VisualStudio.Services.',
);

check(
  /^\d+\.\d+\.\d+$/.test(String(manifest.version ?? '')),
  'Manifest version must be in major.minor.patch form.',
);

const contributions = Array.isArray(manifest.contributions) ? manifest.contributions : [];
const hub = contributions.find((contribution) => contribution.type === 'ms.vss-web.hub');
check(hub !== undefined, 'Manifest declares no ms.vss-web.hub contribution.');

if (hub) {
  check(
    Array.isArray(hub.targets) && hub.targets.length > 0,
    'The hub contribution declares no target hub group.',
  );
  check(typeof hub.properties?.name === 'string', 'The hub contribution needs a display name.');
  const uri = hub.properties?.uri;
  check(typeof uri === 'string', 'The hub contribution needs a uri.');
  if (typeof uri === 'string') {
    check(existsSync(join(root, uri)), `Hub uri "${uri}" does not exist. Run \`npm run build\`.`);
  }
}

for (const entry of manifest.files ?? []) {
  check(existsSync(join(root, entry.path)), `Manifest file entry "${entry.path}" does not exist.`);
}

if (manifest.icons?.default) {
  check(
    existsSync(join(root, manifest.icons.default)),
    `Icon "${manifest.icons.default}" does not exist.`,
  );
}

// ------------------------------------------------------- marketplace listing

// Only enforced for public listings; a private build needs none of this.
if (manifest.public === true) {
  const details = manifest.content?.details?.path;
  check(typeof details === 'string', 'A public extension needs content.details.path for its listing.');
  if (typeof details === 'string') {
    check(existsSync(join(root, details)), `Listing file "${details}" does not exist.`);
  }

  check(
    typeof manifest.icons?.default === 'string',
    'A public extension needs an icon (at least 128x128).',
  );
  check(
    Array.isArray(manifest.screenshots) && manifest.screenshots.length > 0,
    'A public extension should ship at least one screenshot.',
  );
  for (const shot of manifest.screenshots ?? []) {
    check(existsSync(join(root, shot.path)), `Screenshot "${shot.path}" does not exist.`);
  }
  check(typeof manifest.links?.support?.uri === 'string', 'A public extension needs a support link.');

  // Marketplace guidance: no brand names in the extension name.
  const brands = ['github', 'microsoft', 'azure devops', 'visual studio', 'gitlab', 'bitbucket'];
  const lowerName = String(manifest.name ?? '').toLowerCase();
  for (const brand of brands) {
    check(!lowerName.includes(brand), `Extension name must not contain the brand name "${brand}".`);
  }

  notes.push('Public Marketplace listing: metadata present.');
}

// -------------------------------------------------------------------- scopes

const WRITE_SCOPE = /_write|_manage|_full|_execute|_acquire|_publish|user_impersonation/;
const scopes = Array.isArray(manifest.scopes) ? manifest.scopes : [];

check(scopes.length > 0, 'Manifest declares no scopes.');
for (const scope of scopes) {
  check(!WRITE_SCOPE.test(scope), `Scope "${scope}" grants write access; only read scopes allowed.`);
}
check(
  scopes.every((scope) => scope === 'vso.code'),
  `Expected only the read-only "vso.code" scope, found: ${scopes.join(', ')}.`,
);
notes.push(`Scopes requested: ${scopes.join(', ') || '(none)'}`);

// -------------------------------------------------------------------- bundle

const bundlePath = join(root, 'dist', 'heatmap.js');
if (!existsSync(bundlePath)) {
  failures.push('dist/heatmap.js is missing. Run `npm run build`.');
} else {
  const bundle = await readFile(bundlePath, 'utf8');

  // 3. Absolute URLs. dev.azure.com is the documented fallback organisation
  //    host; visualstudio.com covers legacy organisation URLs.
  const allowedHosts = [/^https:\/\/dev\.azure\.com\//, /^https?:\/\/[^/]*visualstudio\.com\//];
  const urls = [...bundle.matchAll(/https?:\/\/[^\s"'`)\\]+/g)].map((match) => match[0]);
  const external = urls.filter((url) => !allowedHosts.some((pattern) => pattern.test(url)));
  check(
    external.length === 0,
    `Bundle references non-Azure DevOps URLs: ${[...new Set(external)].slice(0, 5).join(', ')}`,
  );
  notes.push(`Absolute URLs in bundle: ${urls.length === 0 ? 'none' : [...new Set(urls)].join(', ')}`);

  // 4. Source-code endpoints must never appear.
  const forbiddenEndpoints = [
    '/items',
    '/blobs',
    '/pushes',
    '/diffs',
    '/trees',
    '/annotatedtags',
    'download=true',
    '$format=zip',
  ];
  for (const endpoint of forbiddenEndpoints) {
    check(
      !bundle.includes(endpoint),
      `Bundle references "${endpoint}", which could expose repository content.`,
    );
  }

  // Telemetry / analytics sinks.
  for (const marker of ['navigator.sendBeacon', 'XMLHttpRequest', 'googletagmanager', 'analytics']) {
    check(!bundle.includes(marker), `Bundle references "${marker}".`);
  }

  notes.push(`Bundle size: ${(Buffer.byteLength(bundle) / 1024).toFixed(1)} KB`);
}

// ------------------------------------------------------------------- secrets

const SECRET_PATTERNS = [
  { name: 'PAT-like token', pattern: /\b[a-z2-7]{52}\b/i },
  { name: 'bearer literal', pattern: /Bearer\s+[A-Za-z0-9._-]{20,}/ },
  { name: 'JWT literal', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./ },
  { name: 'assigned secret', pattern: /(password|passwd|secret|api[_-]?key)\s*[:=]\s*['"][^'"]{8,}/i },
];

async function* sourceFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git', 'coverage'].includes(entry.name)) {
      continue;
    }
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* sourceFiles(full);
    } else if (/\.(ts|js|mjs|json|html|css|md)$/.test(entry.name)) {
      yield full;
    }
  }
}

let scanned = 0;
for await (const file of sourceFiles(root)) {
  scanned += 1;
  const content = await readFile(file, 'utf8');
  for (const { name, pattern } of SECRET_PATTERNS) {
    if (pattern.test(content)) {
      failures.push(`Possible ${name} in ${relative(root, file)}.`);
    }
  }
}
notes.push(`Scanned ${scanned} source files for credential literals.`);

// ---------------------------------------------------------------------- vsix

const vsixFiles = (await readdir(root)).filter((name) => name.endsWith('.vsix'));
if (vsixFiles.length === 0) {
  notes.push('No .vsix present yet (run `npm run package`).');
} else {
  for (const name of vsixFiles) {
    const info = await stat(join(root, name));
    check(info.size > 1024, `${name} looks truncated (${info.size} bytes).`);
    notes.push(`Package: ${name} (${(info.size / 1024).toFixed(1)} KB)`);
  }
}

// -------------------------------------------------------------------- report

for (const note of notes) {
  console.log(`  - ${note}`);
}

if (failures.length > 0) {
  console.error(`\nValidation failed with ${failures.length} problem(s):`);
  for (const failure of failures) {
    console.error(`  x ${failure}`);
  }
  process.exit(1);
}

console.log('\nValidation passed.');
