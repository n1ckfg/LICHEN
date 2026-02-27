// commands.js — Command registry with abbreviation resolution
// All GRASS commands register here. Supports prefix abbreviation.

export class CommandRegistry {
  constructor() {
    // Map of uppercase command name -> handler function
    this.commands = new Map();
    // Minimum abbreviation lengths (e.g., P for PRINT)
    this.minLengths = new Map();
  }

  // Register a command
  register(name, handler, minLen) {
    const upper = name.toUpperCase();
    this.commands.set(upper, handler);
    if (minLen !== undefined) {
      this.minLengths.set(upper, minLen);
    }
  }

  // Resolve a name to a command handler
  // Returns { handler, name } or null
  resolve(name) {
    const upper = name.toUpperCase();

    // Exact match first
    if (this.commands.has(upper)) {
      return { handler: this.commands.get(upper), name: upper };
    }

    // Prefix match — find all commands that start with this prefix
    const matches = [];
    for (const [cmdName, handler] of this.commands) {
      const minLen = this.minLengths.get(cmdName) || 1;
      if (upper.length >= minLen && cmdName.startsWith(upper)) {
        matches.push({ handler, name: cmdName });
      }
    }

    // Unambiguous prefix match
    if (matches.length === 1) {
      return matches[0];
    }

    // Ambiguous or no match
    return null;
  }

  // List all registered commands
  list() {
    return Array.from(this.commands.keys()).sort();
  }
}
