#!/usr/bin/env node
// verify — de harde poort. Draai vóór elke commit/deploy en aan het eind van
// een sessie. Nul dependencies, nul build-stap: puur een smoke-check.
//
//   1. JS-syntax van alle game- en atelier-bronbestanden (`node --check`).
//   2. JSON-geldigheid van de data- en manifest-bestanden.
//
// Bewust géén lint/format/tests (die bestaan nog niet in deze repo — zie
// docs/BACKLOG.md). Dit is de minimale poort die deploybreuk door een
// syntax- of JSON-fout tegenhoudt. Uitbreiden mag, verlagen niet.

import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'preview', 'vendor']);

function walk(dir, exts, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      walk(p, exts, acc);
    } else if (exts.includes(extname(name))) {
      acc.push(p);
    }
  }
  return acc;
}

let errors = 0;

// 1. JS-syntax ------------------------------------------------------------
const jsFiles = [];
for (const r of ['js', 'atelier']) walk(join(ROOT, r), ['.js', '.mjs'], jsFiles);
if (existsSync(join(ROOT, 'sw.js'))) jsFiles.push(join(ROOT, 'sw.js'));

for (const f of jsFiles) {
  const res = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (res.status !== 0) {
    errors++;
    console.error(`  JS   ✗ ${f.replace(ROOT + '/', '')}`);
    if (res.stderr) console.error('       ' + res.stderr.split('\n').slice(0, 2).join('\n       '));
  }
}

// 2. JSON-geldigheid ------------------------------------------------------
const jsonFiles = walk(join(ROOT, 'data'), ['.json']);
for (const extra of ['assets/manifest.json', 'atelier/manifest.json']) {
  if (existsSync(join(ROOT, extra))) jsonFiles.push(join(ROOT, extra));
}
for (const f of jsonFiles) {
  try {
    JSON.parse(readFileSync(f, 'utf8'));
  } catch (e) {
    errors++;
    console.error(`  JSON ✗ ${f.replace(ROOT + '/', '')} — ${e.message}`);
  }
}

// Samenvatting ------------------------------------------------------------
if (errors === 0) {
  console.log(`verify ✓  ${jsFiles.length} JS + ${jsonFiles.length} JSON schoon.`);
  process.exit(0);
} else {
  console.error(`verify ✗  ${errors} fout(en) — poort dicht.`);
  process.exit(1);
}
