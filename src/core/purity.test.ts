/**
 * Guards the rule everything else rests on (DESIGN.md §4): the domain layer
 * must be a pure function of the sorted event set.
 *
 * If two devices fold the same events into different state, balances drift
 * apart and nothing ever tells you. The usual causes are ambient reads — the
 * wall clock, a random id, locale-aware formatting — so this test bans them
 * outright rather than trusting review to catch them.
 *
 * Impure inputs belong at the call site: pass the wall clock in, generate ids
 * in the app layer, format money in the view.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CORE_DIR = fileURLToPath(new URL('.', import.meta.url));

const BANNED: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bDate\s*\.\s*now\b/, 'Date.now() — take the wall clock as a parameter instead'],
  [/\bnew\s+Date\b/, 'new Date() — take the wall clock as a parameter instead'],
  [/\bMath\s*\.\s*random\b/, 'Math.random() — generate ids in the app layer'],
  [/\bcrypto\s*\./, 'crypto — generate ids in the app layer'],
  [/\bIntl\b/, 'Intl — locale-aware formatting belongs in the view'],
  [/\bnavigator\b/, 'navigator'],
  [/\bwindow\b/, 'window'],
  [/\bdocument\b/, 'document'],
  [/\blocalStorage\b/, 'localStorage'],
  [/\bsessionStorage\b/, 'sessionStorage'],
  [/\bindexedDB\b/, 'indexedDB — persistence belongs in src/db'],
  [/\bfetch\s*\(/, 'fetch() — this app never makes network calls'],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest — this app never makes network calls'],
  [/\bprocess\s*\./, 'process'],
  [/\bperformance\s*\./, 'performance'],
];

const IMPORT_FROM = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!entry.name.endsWith('.ts')) return [];
    if (entry.name.endsWith('.test.ts')) return [];
    return [path];
  });
}

/** Strips comments and string literals so matches come from real code only. */
function strip(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

describe('src/core stays pure', () => {
  const files = sourceFiles(CORE_DIR);

  it('finds source files to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => [f.slice(f.indexOf('src/')), f] as const))(
    '%s reads nothing ambient',
    (_label, path) => {
      const code = strip(readFileSync(path, 'utf8'));
      const found = BANNED.filter(([pattern]) => pattern.test(code)).map(([, why]) => why);
      expect(found, `${_label} must not use: ${found.join(', ')}`).toEqual([]);
    },
  );

  it.each(files.map((f) => [f.slice(f.indexOf('src/')), f] as const))(
    '%s imports only from within core',
    (_label, path) => {
      const code = readFileSync(path, 'utf8');
      const external = [...code.matchAll(IMPORT_FROM)]
        .map((m) => m[1] as string)
        .filter((spec) => !spec.startsWith('.'));
      expect(external, `${_label} must not depend on packages outside core`).toEqual([]);
    },
  );
});
