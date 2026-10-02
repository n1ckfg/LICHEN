const registry = new Map();

// Old type names, so patches saved before a module was renamed still load
const RENAMED = {
  Cyberlace: 'Cyberlaced',
  Glitch: 'TVGlitch',
};

export function registerModule(typeName, moduleClass) {
  registry.set(typeName, moduleClass);
}

export function createModule(typeName, glCanvas, id) {
  const ModClass = registry.get(RENAMED[typeName] ?? typeName);
  if (!ModClass) throw new Error(`Unknown module type: ${typeName}`);
  return new ModClass(glCanvas, id);
}

export function getModuleTypes() {
  return Array.from(registry.keys());
}

export function getRegistry() {
  return registry;
}
