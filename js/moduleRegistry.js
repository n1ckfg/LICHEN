const registry = new Map();

// Module uid -> type name. Patches save a module's uid, never its name, so a
// module can be renamed freely (see Patch IDs in ARCHITECTURE.md)
const byUid = new Map();

// Classes whose param and port ids have passed checkIds()
const checked = new WeakSet();

const UID = /^[0-9a-f]{8}$/;
const LOCAL_ID = /^[0-9a-f]{4}$/;

export function registerModule(typeName, moduleClass) {
  // Its own uid, so a subclass can't pass with its parent's
  const uid = Object.hasOwn(moduleClass, 'uid') ? moduleClass.uid : undefined;
  if (!UID.test(uid)) throw new Error(`${typeName} needs a static uid of 8 hex digits`);
  if (byUid.has(uid)) throw new Error(`${typeName} has the same uid as ${byUid.get(uid)}`);
  registry.set(typeName, moduleClass);
  byUid.set(uid, typeName);
}

// Params and ports are declared in the constructor, so their ids are checked
// the first time each type is built. They share one namespace per module.
function checkIds(mod) {
  if (checked.has(mod.constructor)) return;
  const ids = new Set();
  const check = (what, id) => {
    if (!LOCAL_ID.test(id)) throw new Error(`${mod.type} ${what} needs an id of 4 hex digits`);
    if (ids.has(id)) throw new Error(`${mod.type} ${what} has the same id as another param or port`);
    ids.add(id);
  };
  for (const [name, param] of Object.entries(mod.params)) check(`param ${name}`, param.id);
  for (const port of mod.inputs) check(`input ${port.name}`, port.id);
  for (const port of mod.outputs) check(`output ${port.name}`, port.id);
  checked.add(mod.constructor);
}

export function createModule(typeName, glCanvas, id) {
  const ModClass = registry.get(typeName);
  if (!ModClass) throw new Error(`Unknown module type: ${typeName}`);
  const mod = new ModClass(glCanvas, id);
  checkIds(mod);
  return mod;
}

// For loading a patch. savedType is the name the patch was saved with, only
// to say which module is missing.
export function createModuleByUid(uid, glCanvas, id, savedType) {
  if (uid === undefined) {
    throw new Error(`${savedType} has no uid: the patch predates ids, so convert it with tools/convert-workflows.mjs`);
  }
  const typeName = byUid.get(uid);
  if (!typeName) throw new Error(`Unknown module uid: ${uid} (saved as ${savedType})`);
  return createModule(typeName, glCanvas, id);
}

export function getModuleTypes() {
  return Array.from(registry.keys());
}

export function getRegistry() {
  return registry;
}
