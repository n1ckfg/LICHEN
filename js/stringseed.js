// StringSeed: the SSoT (String Seed of Thought) protocol, ported from the
// StringSeedGenerator project. Misaki & Akiba (2025), arxiv 2510.21150.
//
//   1. Generate a real hex seed from cryptographic randomness.
//   2. Enumerate axes, each a list of 2+ concrete candidates.
//   3. Map the seed to indices: axis i reads the non-overlapping 4-char hex
//      slice i, converts it to an int, and takes it modulo its candidate count.
//
// Every choice is therefore checkable by hand: `echo $((16#<slice> % <n>))`.
// Module.randomize() drives params through this; see ARCHITECTURE.md.

const SLICE_LEN = 4;

export class StringSeed {
  constructor() {
    this.axes = [];   // [{ name, candidates }]
  }

  // Lower-case hex from crypto.getRandomValues, two chars per byte
  // (the `openssl rand -hex N` convention)
  static generateSeed(numBytes = 8) {
    const bytes = new Uint8Array(numBytes);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }

  // Order matters: an axis's position picks its slice of the seed
  addAxis(name, candidates) {
    if (!Array.isArray(candidates) || candidates.length < 2) {
      throw new Error(`Axis "${name}" must have at least 2 candidates.`);
    }
    this.axes.push({ name, candidates: [...candidates] });
    return this;
  }

  // Bytes generateSeed() needs to give every axis its own slice without wrapping
  requiredSeedBytes() {
    return Math.ceil(this.axes.length * SLICE_LEN / 2);
  }

  // Axis 0 reads chars 0-3, axis 1 chars 4-7, ... A seed too short for the
  // axes wraps, which correlates them, so size seeds with requiredSeedBytes().
  static getSlice(seed, axisIndex) {
    const start = (axisIndex * SLICE_LEN) % seed.length;
    let slice = '';
    for (let i = 0; i < SLICE_LEN; i++) {
      slice += seed[(start + i) % seed.length];
    }
    return slice.toLowerCase();
  }

  static mapToIndex(hexSlice, n) {
    const intValue = parseInt(hexSlice, 16);
    if (isNaN(intValue) || n < 1) return { intValue: 0, index: 0 };
    return { intValue, index: intValue % n };
  }

  // One traceable entry per axis: { axis, hexSlice, intValue, n, index, choice }.
  // Non-hex characters in the seed are ignored.
  resolve(seed) {
    const clean = seed.replace(/[^0-9a-fA-F]/g, '').toLowerCase();

    if (clean.length === 0) {
      // Degenerate seed: every axis falls back to candidate 0
      return this.axes.map(a => ({
        axis: a.name, hexSlice: '0000', intValue: 0,
        n: a.candidates.length, index: 0, choice: a.candidates[0],
      }));
    }

    return this.axes.map((axis, i) => {
      const hexSlice = StringSeed.getSlice(clean, i);
      const { intValue, index } = StringSeed.mapToIndex(hexSlice, axis.candidates.length);
      return {
        axis: axis.name, hexSlice, intValue,
        n: axis.candidates.length, index, choice: axis.candidates[index],
      };
    });
  }
}
