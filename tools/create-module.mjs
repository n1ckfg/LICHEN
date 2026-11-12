// Creates a new module from the Example template, as "Adding a New Module" in
// ARCHITECTURE.md lays out.
//
// Usage: node tools/create-module.mjs <Name> [--category <category>]
//
// For Name "Spiral" it:
//   1. writes js/shaders/spiral.js from js/shaders/example.js (export spiralFrag)
//   2. writes js/modules/SpiralModule.js from js/modules/ExampleModule.js
//      (class SpiralModule, type 'Spiral')
//   3. gives the module fresh ids with tools/new-uids.mjs
//   4. imports it in js/main.js
//   5. adds 'Spiral' to its category in MODULE_CATEGORIES in js/ui.js, and to
//      MODULE_COLORS with the colour the category's modules use
//
// The category is a MODULE_CATEGORIES key and defaults to Effects. The name is
// placed in alphabetical order among the category's modules in all three
// places. Nothing is written unless every step can be done, and the new files
// are removed again if new-uids.mjs fails.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (p) => path.relative(ROOT, p);
const MODULES = path.join(ROOT, 'js', 'modules');
const SHADERS = path.join(ROOT, 'js', 'shaders');
const MAIN = path.join(ROOT, 'js', 'main.js');
const UI = path.join(ROOT, 'js', 'ui.js');
const NEW_UIDS = path.join(ROOT, 'tools', 'new-uids.mjs');
const TEMPLATE_MODULE = path.join(MODULES, 'ExampleModule.js');
const TEMPLATE_SHADER = path.join(SHADERS, 'example.js');

function fail(message) {
  console.error(message);
  process.exit(1);
}

// - - - Arguments - - -

const USAGE = 'Usage: node tools/create-module.mjs <Name> [--category <category>]';
const args = process.argv.slice(2);
let name = null;
let category = 'Effects';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--category') {
    category = args[++i];
    if (!category) fail(USAGE);
  } else if (args[i].startsWith('--')) {
    fail(`Unknown option ${args[i]}\n${USAGE}`);
  } else if (name === null) {
    name = args[i];
  } else {
    fail(USAGE);
  }
}
if (!name) fail(USAGE);
if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) {
  fail(`"${name}" is not a type name: start with a capital letter and use only letters and digits, e.g. Spiral`);
}
if (name.endsWith('Module')) {
  fail(`Give the name without "Module": ${name.slice(0, -'Module'.length)}`);
}

// SpiralGalaxy -> spiral-galaxy (file), spiralGalaxy (export prefix)
const kebab = name
  .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
  .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
  .toLowerCase();
const camel = kebab.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
const className = `${name}Module`;
const fragName = `${camel}Frag`;
const moduleFile = path.join(MODULES, `${className}.js`);
const shaderFile = path.join(SHADERS, `${kebab}.js`);

// Alphabetical, ignoring case, as MODULE_CATEGORIES is (Levels before LUT)
const before = (a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }) < 0;

// Where to put the new name among a category's rows ([type, line] pairs),
// which may be spread out and out of order: after the row whose type sorts
// just before it, else before the row whose type sorts first
function slot(rows) {
  const sorted = [...rows].sort(([a], [b]) => (before(a, b) ? -1 : 1));
  const prev = sorted.filter(([t]) => before(t, name)).pop();
  return { prev, at: prev ? prev[1] + 1 : sorted[0][1] };
}

// - - - Checks - - -

for (const file of [moduleFile, shaderFile]) {
  if (fs.existsSync(file)) fail(`${rel(file)} already exists`);
}

const mainText = fs.readFileSync(MAIN, 'utf8');
const uiText = fs.readFileSync(UI, 'utf8');

const catBlock = uiText.match(/const MODULE_CATEGORIES = \{\n([\s\S]*?)\n\};/);
if (!catBlock) fail('MODULE_CATEGORIES not found in js/ui.js');
const categories = new Map();
for (const m of catBlock[1].matchAll(/^\s*'([^']+)':\s*\[(.*)\],?\s*$/gm)) {
  categories.set(m[1], [...m[2].matchAll(/'([^']+)'/g)].map((t) => t[1]));
}
if (!categories.has(category)) {
  fail(`Unknown category "${category}". Use one of: ${[...categories.keys()].join(', ')}`);
}
for (const [cat, types] of categories) {
  if (types.includes(name)) fail(`${name} is already in the ${cat} category in js/ui.js`);
}
const peers = categories.get(category);

// A type registered by any module, even one not in a category, is taken
for (const file of fs.readdirSync(MODULES)) {
  if (!file.endsWith('.js')) continue;
  const text = fs.readFileSync(path.join(MODULES, file), 'utf8');
  if (new RegExp(`registerModule\\(\\s*['"]${name}['"]`).test(text)) {
    fail(`js/modules/${file} already registers type ${name}`);
  }
}

// - - - New files' text - - -

let moduleText = fs.readFileSync(TEMPLATE_MODULE, 'utf8');
let shaderText = fs.readFileSync(TEMPLATE_SHADER, 'utf8');

moduleText = moduleText
  .replaceAll('exampleFrag', fragName)
  .replaceAll("'../shaders/example.js'", `'../shaders/${kebab}.js'`)
  .replaceAll('ExampleModule', className)
  .replaceAll("'Example'", `'${name}'`);
shaderText = shaderText.replaceAll('exampleFrag', fragName);

for (const leftover of ['Example', 'example']) {
  if (moduleText.includes(leftover)) fail(`js/modules/ExampleModule.js has an "${leftover}" this script does not replace`);
}
if (shaderText.includes('exampleFrag')) fail('js/shaders/example.js has an exampleFrag this script does not replace');

// - - - js/main.js: import - - -

const importLine = `import './modules/${className}.js';`;
function addImport(text) {
  const lines = text.split('\n');
  const importOf = (line) => line.match(/^import '\.\/modules\/(\w+)Module\.js';\s*$/)?.[1];
  const peerRows = lines.map((l, i) => [importOf(l), i]).filter(([t]) => t && peers.includes(t));
  let at;
  if (peerRows.length) {
    at = slot(peerRows).at;
  } else {
    // No peer imported yet: after the last module import
    const last = lines.map((l, i) => [importOf(l), i]).filter(([t]) => t).pop();
    if (!last) fail('No module imports found in js/main.js');
    at = last[1] + 1;
  }
  lines.splice(at, 0, importLine);
  return lines.join('\n');
}

// - - - js/ui.js: MODULE_CATEGORIES and MODULE_COLORS - - -

function addToCategory(text) {
  const row = new RegExp(`^(\\s*'${category}':\\s*\\[)(.*)(\\],?\\s*)$`, 'm');
  return text.replace(row, (_, open, list, close) => {
    const types = [...peers];
    const at = types.findIndex((t) => before(name, t));
    types.splice(at === -1 ? types.length : at, 0, name);
    return open + types.map((t) => `'${t}'`).join(', ') + close;
  });
}

function addColor(text) {
  const block = text.match(/const MODULE_COLORS = \{\n([\s\S]*?)\n\};/);
  if (!block) fail('MODULE_COLORS not found in js/ui.js');
  const start = block.index + block[0].indexOf('\n') + 1;
  const lines = block[1].split('\n');
  const entryOf = (line) => line.match(/^(\s*)(\w+):\s*(\w+)\s*(,?)\s*$/);
  const entries = lines
    .map((l, i) => [entryOf(l), i])
    .filter(([m]) => m && peers.includes(m[2]));
  if (!entries.length) fail(`No ${category} module has a colour in MODULE_COLORS to copy`);

  // The colour most of the category's modules use (Effects has two)
  const counts = new Map();
  for (const [m] of entries) counts.set(m[3], (counts.get(m[3]) ?? 0) + 1);
  const color = [...counts].sort((a, b) => b[1] - a[1])[0][0];
  const indent = entries[0][0][1];

  const { prev, at } = slot(entries.map(([m, i]) => [m[2], i]));
  // Going after the block's last entry, which may have no trailing comma
  // (Monitor's doesn't): give it one, and leave the new entry as it was
  let comma = ',';
  const lastEntry = lines.findLastIndex((l) => entryOf(l));
  if (at > lastEntry && !lines[prev[1]].trimEnd().endsWith(',')) {
    lines[prev[1]] = lines[prev[1]].replace(/\s*$/, ',');
    comma = '';
  }
  lines.splice(at, 0, `${indent}${name}: ${color}${comma}`);

  return { text: text.slice(0, start) + lines.join('\n') + text.slice(start + block[1].length), color };
}

const newMain = addImport(mainText);
const withCategory = addToCategory(uiText);
if (withCategory === uiText) fail(`Could not add ${name} to the ${category} row of MODULE_CATEGORIES`);
const { text: newUi, color } = addColor(withCategory);

// - - - Write - - -

fs.writeFileSync(shaderFile, shaderText);
fs.writeFileSync(moduleFile, moduleText);
console.log(`created ${rel(shaderFile)} (${fragName})`);
console.log(`created ${rel(moduleFile)} (${className}, type '${name}')`);

try {
  execFileSync(process.execPath, [NEW_UIDS, moduleFile], { cwd: ROOT, stdio: 'inherit' });
} catch {
  fs.rmSync(moduleFile, { force: true });
  fs.rmSync(shaderFile, { force: true });
  fail('tools/new-uids.mjs failed; removed the new files and left js/main.js and js/ui.js alone');
}

fs.writeFileSync(MAIN, newMain);
fs.writeFileSync(UI, newUi);
console.log(`js/main.js: ${importLine}`);
console.log(`js/ui.js: added '${name}' to ${category} in MODULE_CATEGORIES, and ${name}: ${color} to MODULE_COLORS`);
