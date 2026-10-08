// Converts patches saved before ids (modules by type name, params by name,
// ports by number) to the format that saves them by id (see Patch IDs in
// ARCHITECTURE.md).
//
// The ids come from legacy-ids.json: every module's type name, param names and
// port order as they were when ids were added. Old patches use those names, so
// never regenerate it from later code, where a renamed module, param or port
// would no longer match.
//
// Usage: node tools/convert-workflows.mjs <patch.json> [...]
//
// Each file is converted in place. One that already has ids is left alone. A
// module type, param, port or node the table doesn't have is an error, and that
// file is not written.
//
// Examples, from the repo root:
//   node tools/convert-workflows.mjs workflows/rainbow.json
//   node tools/convert-workflows.mjs workflows/*.json
//   node tools/convert-workflows.mjs workflows/*.json ../lichen-patches/*.json
//   node tools/convert-workflows.mjs ~/Downloads/lichen-patch_2026-10-07T14-30-00.json
//
// It prints a line per file, and exits with 1 if any file failed:
//   workflows/rainbow.json: converted
//   workflows/undersea.json: already has ids
//   old/typo.json: unknown module type Comparatorr

import fs from 'node:fs';

const LEGACY = JSON.parse(fs.readFileSync(new URL('./legacy-ids.json', import.meta.url), 'utf8'));

function convert(patch) {
  const fail = (msg) => { throw new Error(msg); };

  // Node id -> its module's entry in LEGACY
  const entries = new Map();
  const nodes = patch.nodes.map((node) => {
    const entry = LEGACY[node.type] ?? fail(`unknown module type ${node.type}`);
    entries.set(node.id, entry);
    const params = {};
    for (const [name, value] of Object.entries(node.params ?? {})) {
      params[entry.params[name] ?? fail(`${node.type} has no param ${name}`)] = value;
    }
    // Same key order as ConnectionGraph.toJSON()
    const { id, type, ...rest } = node;
    return { id, uid: entry.uid, type, ...rest, params };
  });

  const entry = (nodeId) => entries.get(nodeId) ?? fail(`a cable names node ${nodeId}, which isn't in the patch`);
  const port = (nodeId, side, index) =>
    entry(nodeId)[side][index] ?? fail(`node ${nodeId} has no ${side.slice(0, -1)} ${index}`);

  return {
    ...patch,
    nodes,
    connections: patch.connections.map((c) => ({
      fromId: c.fromId,
      fromPort: port(c.fromId, 'outputs', c.fromPort),
      toId: c.toId,
      toPort: port(c.toId, 'inputs', c.toPort),
    })),
    controlConnections: (patch.controlConnections ?? []).map((c) => ({
      fromId: c.fromId,
      fromPort: port(c.fromId, 'outputs', c.fromPort),
      toId: c.toId,
      param: entry(c.toId).params[c.paramName] ?? fail(`node ${c.toId} has no param ${c.paramName}`),
    })),
  };
}

let failed = false;
for (const file of process.argv.slice(2)) {
  const text = fs.readFileSync(file, 'utf8');
  const patch = JSON.parse(text);
  if (patch.nodes.every((node) => 'uid' in node)) {
    console.log(`${file}: already has ids`);
    continue;
  }
  try {
    const out = JSON.stringify(convert(patch), null, 2) + (text.endsWith('\n') ? '\n' : '');
    fs.writeFileSync(file, out);
    console.log(`${file}: converted`);
  } catch (e) {
    console.error(`${file}: ${e.message}`);
    failed = true;
  }
}
if (failed) process.exit(1);
