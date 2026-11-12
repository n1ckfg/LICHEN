// Gives a module class fresh ids: a new static uid, and a new id for every
// param and port it declares, as step 3 of "Adding a New Module" asks (see
// Patch IDs in ARCHITECTURE.md).
//
// Usage: node tools/new-uids.mjs <module.js> [...]
//
// Each file is rewritten in place. Its class keeps its name and everything
// else. A uid the class is missing is added after the class declaration.
// The new ids avoid every id in js/modules and tools/legacy-ids.json, so none
// repeats one that is used now or was used when ids were added.
//
// Patches save modules by uid and params and ports by id, so a module whose
// ids are changed no longer loads its saved nodes. Run this on a new or
// copied module, never one that has been saved in a patch.

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULES = path.join(ROOT, 'js', 'modules');
const LEGACY = path.join(ROOT, 'tools', 'legacy-ids.json');

const UID = /static\s+uid\s*=\s*(['"])([0-9a-f]{8})\1/;
const ID = /\bid:\s*(['"])([0-9a-f]{4})\1/g;
const CLASS = /(?:export\s+)?class\s+(\w+)\s+extends\s+Module\s*\{/;

const usedUids = new Set();
const usedIds = new Set();

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) scan(fs.readFileSync(full, 'utf8'));
  }
}

// Every uid and id declared in current module source, and every one in the
// frozen pre-id table, is taken
function scan(text) {
  for (const m of text.matchAll(new RegExp(UID.source, 'g'))) usedUids.add(m[2]);
  for (const m of text.matchAll(ID)) usedIds.add(m[2]);
}

function fresh(set, bytes) {
  let value;
  do {
    value = randomBytes(bytes).toString('hex');
  } while (set.has(value));
  set.add(value);
  return value;
}

// Replace every match with a fresh value, keeping each match's quotes
function replaceAll(text, matches, makeValue) {
  let out = '';
  let last = 0;
  for (const m of matches) {
    out += text.slice(last, m.index) + m[0].replace(m[2], makeValue());
    last = m.index + m[0].length;
  }
  return out + text.slice(last);
}

function update(file) {
  const abs = path.resolve(file);
  let text = fs.readFileSync(abs, 'utf8');

  const cls = text.match(CLASS);
  if (!cls) throw new Error(`no class extending Module found in ${file}`);

  const uidMatch = text.match(UID);
  const oldUid = uidMatch?.[2];
  const newUid = fresh(usedUids, 4);
  if (uidMatch) {
    text = replaceAll(text, [uidMatch], () => newUid);
  } else {
    text = text.replace(CLASS, `${cls[0]}\n  static uid = '${newUid}';`);
  }

  const idMatches = [...text.matchAll(ID)];
  const oldIds = idMatches.map((m) => m[2]);
  const newIds = oldIds.map(() => fresh(usedIds, 2));
  let next = 0;
  text = replaceAll(text, idMatches, () => newIds[next++]);

  fs.writeFileSync(abs, text);

  console.log(`${path.relative(ROOT, abs)}: ${cls[1]}`);
  console.log(`  uid ${oldUid ?? '(added)'} -> ${newUid}`);
  idMatches.forEach((m, i) => {
    const line = text.slice(0, m.index).split('\n').length;
    console.log(`  id ${oldIds[i]} -> ${newIds[i]} (line ${line})`);
  });
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Usage: node tools/new-uids.mjs <module.js> [...]');
  process.exit(1);
}

walk(MODULES);

// The frozen pre-id table holds uids and ids as JSON values, not declarations
const legacy = JSON.parse(fs.readFileSync(LEGACY, 'utf8'));
for (const entry of Object.values(legacy)) {
  usedUids.add(entry.uid);
  for (const id of Object.values(entry.params)) usedIds.add(id);
  for (const id of [...entry.inputs, ...entry.outputs]) usedIds.add(id);
}

let failed = false;
for (const file of files) {
  try {
    update(file);
  } catch (err) {
    console.error(`${file}: ${err.message}`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
