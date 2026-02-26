// environment.js — Globals, locals (MIB stack), device variables
// ZGRASS variable rules:
//   - Uppercase start = global
//   - Lowercase start = local (scoped to macro invocation)
//   - $XX = device variable
//   - Arrays created with ARRAY command

export class Environment {
  constructor() {
    // Global variables (uppercase names, macros, etc.)
    this.globals = new Map();
    // Device variables ($XX)
    this.devices = new Map();
    // Arrays (name -> { data, dimensions })
    this.arrays = new Map();
    // MIB stack for local variable scoping during macro execution
    this.mibStack = [];
    // Error handler label
    this.onErrorLabel = null;

    // Initialize device variables with defaults
    this.initDeviceVars();
  }

  initDeviceVars() {
    // Joystick/mouse port 1
    this.devices.set('$X1', 0);
    this.devices.set('$Y1', 0);
    this.devices.set('$T1', 0);  // trigger/mouse button
    this.devices.set('$K1', 0);  // last key

    // Joystick ports 2-4 (stubbed)
    for (let port = 2; port <= 4; port++) {
      this.devices.set(`$X${port}`, 0);
      this.devices.set(`$Y${port}`, 0);
      this.devices.set(`$T${port}`, 0);
      this.devices.set(`$K${port}`, 0);
    }

    // Color palette slots
    for (let i = 0; i <= 3; i++) {
      this.devices.set(`$L${i}`, i);  // left colors: 0,1,2,3
      this.devices.set(`$R${i}`, i);  // right colors
    }

    // Horizontal boundary
    this.devices.set('$HB', 320);

    // Clock
    this.devices.set('$HR', 0);
    this.devices.set('$MN', 0);
    this.devices.set('$SC', 0);

    // Timers
    for (let i = 0; i <= 9; i++) {
      this.devices.set(`$Z${i}`, 0);
    }

    // Radians/degrees mode (0=degrees, 1=radians)
    this.devices.set('$RD', 0);
  }

  // Get a variable value
  get(name) {
    const upper = name.toUpperCase();

    // Device variable
    if (upper.startsWith('$')) {
      return this.devices.get(upper) ?? 0;
    }

    // Local variable (lowercase first char) — check MIB stack
    if (name[0] >= 'a' && name[0] <= 'z') {
      const lower = name.toLowerCase();
      if (this.mibStack.length > 0) {
        const frame = this.mibStack[this.mibStack.length - 1];
        if (frame.locals.has(lower)) {
          return frame.locals.get(lower);
        }
      }
      // Fall through to globals if not in a macro
    }

    // Global or macro name
    return this.globals.get(upper) ?? 0;
  }

  // Set a variable value
  set(name, value) {
    const upper = name.toUpperCase();

    // Device variable
    if (upper.startsWith('$')) {
      this.devices.set(upper, value);
      return;
    }

    // Local variable (lowercase first char) — set in current MIB
    if (name[0] >= 'a' && name[0] <= 'z') {
      if (this.mibStack.length > 0) {
        this.mibStack[this.mibStack.length - 1].locals.set(name.toLowerCase(), value);
        return;
      }
    }

    // Global
    this.globals.set(upper, value);
  }

  // Set a device variable directly (from main.js device update)
  setDevice(name, value) {
    this.devices.set(name.toUpperCase(), value);
  }

  // Create an array
  createArray(name, ...dimensions) {
    const upper = name.toUpperCase();
    const totalSize = dimensions.reduce((a, b) => a * b, 1);
    this.arrays.set(upper, {
      data: new Float64Array(totalSize),
      dimensions: dimensions
    });
  }

  // Get array element
  getArray(name, ...indices) {
    const upper = name.toUpperCase();
    const arr = this.arrays.get(upper);
    if (!arr) throw new Error(`Array ${name} not defined`);
    const idx = this.arrayIndex(arr, indices);
    return arr.data[idx];
  }

  // Set array element
  setArray(name, indices, value) {
    const upper = name.toUpperCase();
    const arr = this.arrays.get(upper);
    if (!arr) throw new Error(`Array ${name} not defined`);
    const idx = this.arrayIndex(arr, indices);
    arr.data[idx] = value;
  }

  arrayIndex(arr, indices) {
    if (indices.length === 1) {
      const i = Math.floor(indices[0]);
      if (i < 0 || i >= arr.data.length) throw new Error('Array index out of bounds');
      return i;
    }
    if (indices.length === 2 && arr.dimensions.length === 2) {
      const [r, c] = indices.map(Math.floor);
      if (r < 0 || r >= arr.dimensions[0] || c < 0 || c >= arr.dimensions[1]) {
        throw new Error('Array index out of bounds');
      }
      return r * arr.dimensions[1] + c;
    }
    throw new Error('Wrong number of array indices');
  }

  // Push a new MIB frame (macro invocation)
  pushMIB(macroName, args) {
    this.mibStack.push({
      macroName,
      locals: new Map(),
      args: args || [],
      argIndex: 0,
      pc: 0,
      lines: [],
      labels: new Map(),
      returnValue: 0,
      onErrorLabel: null,
    });
  }

  // Pop MIB frame
  popMIB() {
    return this.mibStack.pop();
  }

  // Get current MIB frame
  currentMIB() {
    return this.mibStack.length > 0 ? this.mibStack[this.mibStack.length - 1] : null;
  }

  // Check if a name is a defined macro (string value in globals)
  isMacro(name) {
    const val = this.globals.get(name.toUpperCase());
    return typeof val === 'string';
  }

  // Get all user-defined names
  getUserNames() {
    return Array.from(this.globals.keys());
  }

  // Delete a name
  delete(name) {
    const upper = name.toUpperCase();
    this.globals.delete(upper);
    this.arrays.delete(upper);
  }

  // Update clock device vars
  updateClock() {
    const now = new Date();
    this.devices.set('$HR', now.getHours());
    this.devices.set('$MN', now.getMinutes());
    this.devices.set('$SC', now.getSeconds());
  }
}
