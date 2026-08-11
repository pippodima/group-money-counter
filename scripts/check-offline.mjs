/**
 * Fails the build if the bundle could talk to the network.
 *
 * The privacy claim is the product: code comes from a server, data never
 * does. A single stray CDN import, web font, or analytics snippet would
 * quietly falsify that, and nobody reviews a diff for it. So it is checked
 * mechanically on every build.
 *
 *   npm run check:offline        (runs as part of npm run build)
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, extname, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const SCANNED = new Set(['.js', '.mjs', '.css', '.html', '.webmanifest', '.json']);

/**
 * Hosts that appear only inside string literals and are never contacted.
 * Every entry needs a reason. Verified by inspecting the built bundle.
 */
const ALLOWED_HOSTS = new Set([
  'www.w3.org', // XML/SVG namespace declarations
  'react.dev', // React builds a docs URL into its minified error messages
  'bit.ly', // Workbox console.warn text about unversioned precache URLs
]);

/** APIs that reach the network. Workbox owns fetch inside the service worker. */
const NETWORK_APIS = [
  [/\bnavigator\s*\.\s*sendBeacon\b/, 'navigator.sendBeacon'],
  [/\bnew\s+WebSocket\b/, 'WebSocket'],
  [/\bnew\s+EventSource\b/, 'EventSource'],
  [/\bnew\s+XMLHttpRequest\b/, 'XMLHttpRequest'],
  [/\bnew\s+RTCPeerConnection\b/, 'RTCPeerConnection'],
  [/\bimportScripts\s*\(/, 'importScripts'],
];

const URL_PATTERN = /\bhttps?:\/\/([a-z0-9.-]+)/gi;

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : SCANNED.has(extname(entry.name)) ? [path] : [];
  });
}

if (!existsSync(DIST)) {
  console.error('check-offline: dist/ not found — run vite build first');
  process.exit(1);
}

const problems = [];
const files = walk(DIST);

for (const path of files) {
  const name = relative(ROOT, path);
  const source = readFileSync(path, 'utf8');
  const isServiceWorker = /(^|\/)(sw|workbox-[^/]+)\.js$/.test(name);

  for (const [, host] of source.matchAll(URL_PATTERN)) {
    if (!ALLOWED_HOSTS.has(host.toLowerCase())) {
      problems.push(`${name}: references external host ${host}`);
    }
  }

  // The service worker legitimately handles fetch events; the app must not.
  if (!isServiceWorker && /\bfetch\s*\(/.test(source)) {
    problems.push(`${name}: calls fetch()`);
  }

  for (const [pattern, label] of NETWORK_APIS) {
    if (pattern.test(source)) problems.push(`${name}: uses ${label}`);
  }
}

const unique = [...new Set(problems)];

if (unique.length > 0) {
  console.error(`\ncheck-offline: FAILED — the bundle can reach the network\n`);
  for (const problem of unique) console.error(`  ${problem}`);
  console.error(
    `\nEverything must be bundled and served from the origin. If a hit is a false\n` +
      `positive, allowlist it explicitly in scripts/check-offline.mjs.\n`,
  );
  process.exit(1);
}

console.log(`check-offline: ${files.length} files scanned, no network access found`);
