// commands.js — Command registry with abbreviation resolution
// All GRASS commands register here. Supports prefix abbreviation.

export class CommandRegistry {
  constructor() {
    // Map of uppercase command name -> handler function
    this.commands = new Map();
    // Minimum abbreviation lengths (e.g., P for PRINT)
    this.minLengths = new Map();
    // Commands that also run when their whole name is used as a value in an
    // expression (PI, ANYARGS), unless a variable has that name
    this.valueNames = new Set();
    // Set to a function returning true for exact names only ($AB=1, as RT/1
    // had it); abbreviations then go to macros and variables
    this.exactOnly = null;
    // The switches each command takes. A command not listed takes none
    this.switches = new Map();
  }

  // Register a command. switches lists the switches it takes: words, which
  // may be abbreviated as Zgrass allowed (CL.C is CLEAR.CRT, INPUT.S is
  // INPUT.STR), or single letters, which may be run together as RT/1 allowed
  // (MIRROR.XY is MIRROR.X.Y)
  register(name, handler, minLen, switches) {
    const upper = name.toUpperCase();
    this.commands.set(upper, handler);
    if (minLen !== undefined) {
      this.minLengths.set(upper, minLen);
    }
    if (switches) this.switches.set(upper, switches.map(w => w.toUpperCase()));
  }

  // The switches given to command `name`, each written out in full as the
  // command's handler expects it, or an error for one it doesn't take, as
  // RT/1's "illegal/unknown switch" (ER_SW)
  checkSwitches(name, given) {
    if (!given.length) return given;
    const known = this.switches.get(name) || [];
    const letters = known.filter(w => w.length === 1);
    return given.map(sw => {
      const upper = sw.toUpperCase();
      if (known.includes(upper)) return upper;
      const word = known.filter(w => w.length > 1 && w.startsWith(upper));
      if (word.length === 1) return word[0];
      if (upper.length > 1 && [...upper].every(c => letters.includes(c))) return upper;
      throw new Error(`Unknown switch .${upper} for ${name}`);
    });
  }

  // Resolve a name to a command handler
  // Returns { handler, name } or null
  resolve(name) {
    const upper = name.toUpperCase();

    // Exact match first
    if (this.commands.has(upper)) {
      return { handler: this.commands.get(upper), name: upper };
    }
    if (this.exactOnly && this.exactOnly()) return null;

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

    // Several match: the one with the shortest abbreviation wins, as P and PR
    // are PRINT although PROMPT also starts with them
    if (matches.length > 1) {
      const len = (m) => this.minLengths.get(m.name) || 1;
      const shortest = Math.min(...matches.map(len));
      const best = matches.filter(m => len(m) === shortest);
      if (best.length === 1) return best[0];
    }

    // Ambiguous or no match
    return null;
  }

  // List all registered commands
  list() {
    return Array.from(this.commands.keys()).sort();
  }
}
