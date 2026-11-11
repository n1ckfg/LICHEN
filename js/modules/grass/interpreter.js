// interpreter.js — Tree-walking evaluator + macro execution
// Evaluates AST nodes, dispatches commands, handles macro invocation.

import { tokenize } from './tokenizer.js';
import { parse } from './parser.js';
import { CommandRegistry } from './commands.js';
import { splitMacroLines } from './script.js';
import { registerGraphicsCommands } from './builtins/graphics.js';
import { registerIOCommands } from './builtins/io.js';
import { registerMathCommands } from './builtins/math.js';
import { registerControlCommands } from './builtins/control.js';
import { registerSystemCommands } from './builtins/system.js';

export class Interpreter {
  constructor(env, framebuffer, palette, spriteStore, terminal, repl, scheduler) {
    this.env = env;
    this.fb = framebuffer;
    this.palette = palette;
    this.sprites = spriteStore;
    this.terminal = terminal;
    this.repl = repl;
    this.scheduler = scheduler;
    this.commands = new CommandRegistry();
    this.currentTask = null; // Set during scheduled execution

    // Register all builtin commands
    registerGraphicsCommands(this);
    registerIOCommands(this);
    registerMathCommands(this);
    registerControlCommands(this);
    registerSystemCommands(this);
  }

  // Execute a line of GRASS source (from REPL or task)
  execLine(source, task) {
    const prevTask = this.currentTask;
    if (task) this.currentTask = task;

    try {
      const tokens = tokenize(source);
      const ast = parse(tokens);
      return this.eval(ast);
    } finally {
      this.currentTask = prevTask;
    }
  }

  // Run a command typed at the prompt (or read from a script). A line that
  // is just a macro's name, with any arguments (DRAW, GRIDBOXES 30), starts
  // that macro in the middleground: it runs over frames, holding the prompt
  // until it ends, so its loops can read the joystick and its INPUTs wait for
  // a typed answer. Returns the task then, else null after running the line
  // here and now. A macro called any other way (inside an expression, or
  // from another macro) still runs inline, as one line of its caller
  execTopLevel(source) {
    const ast = parse(tokenize(source));
    if (ast && ast.type === 'Command' && !this.commands.resolve(ast.name) &&
        !(ast.switches || []).some(s => s === 'B' || s === 'F')) {
      let name = null;
      if (this.env.isMacro(ast.name)) {
        name = ast.name;
      } else {
        const full = this.env.resolvePrefix(ast.name);
        if (full && this.env.isMacro(full)) name = full;
      }
      if (name) {
        const args = ast.args.map(a => this.eval(a));
        const lines = splitMacroLines(this.env.get(name));
        return this.scheduler.addTask('MG', name.toUpperCase(), lines, args, this.env.newMIB(name, args));
      }
    }
    this.eval(ast);
    return null;
  }

  // Evaluate an AST node
  eval(node) {
    if (node === null || node === undefined) return 0;

    switch (node.type) {
      case 'NumLit':
        return node.value;

      case 'StrLit':
        return node.value;

      case 'VarRef':
        return this.env.get(node.name);

      case 'ArrayRef':
        return this.evalArrayRef(node);

      case 'Assign':
        return this.evalAssign(node);

      case 'ArrayAssign':
        return this.evalArrayAssign(node);

      case 'BinOp':
        return this.evalBinOp(node);

      case 'UnaryOp':
        return this.evalUnaryOp(node);

      case 'Command':
        return this.evalCommand(node);

      case 'Sequence':
        return this.evalSequence(node);

      case 'IfStmt':
        return this.evalIf(node);

      case 'Paren':
        return this.eval(node.expr);

      case 'LabeledLine':
        return this.evalSequence({ stmts: node.commands });

      default:
        throw new Error(`Unknown AST node type: ${node.type}`);
    }
  }

  evalAssign(node) {
    const value = this.eval(node.expr);
    this.env.set(node.name, value);

    // Sync device vars to palette if needed
    this.syncDeviceVar(node.name, value);

    return value;
  }

  evalArrayAssign(node) {
    const indices = node.indices.map(i => this.eval(i));
    const value = this.eval(node.expr);

    // Check if it's an actual array
    const upper = node.name.toUpperCase();
    if (this.env.arrays.has(upper)) {
      this.env.setArray(node.name, indices, value);
    } else {
      // Could be function-style assignment — treat as regular assignment for now
      this.env.set(node.name, value);
    }
    return value;
  }

  evalArrayRef(node) {
    const upper = node.name.toUpperCase();

    // Check if it's an array first (takes priority)
    if (this.env.arrays.has(upper)) {
      const indices = node.indices.map(i => this.eval(i));
      return this.env.getArray(node.name, ...indices);
    }

    // Check if it's a registered command/function
    const cmd = this.commands.resolve(node.name);
    if (cmd) {
      const args = node.indices.map(i => this.eval(i));
      return cmd.handler(args, [], this);
    }

    // A macro called as a function returns what its RETURN gives
    if (this.env.isMacro(node.name)) {
      return this.invokeMacro(node.name, node.indices, []);
    }

    // An abbreviated array or macro name: PY(L) for PYR(L)
    const full = this.env.resolvePrefix(node.name);
    if (full && this.env.arrays.has(full)) {
      return this.env.getArray(full, ...node.indices.map(i => this.eval(i)));
    }
    if (full && this.env.isMacro(full)) {
      return this.invokeMacro(full, node.indices, []);
    }

    // Fall back to variable reference
    return this.env.get(node.name);
  }

  evalBinOp(node) {
    const left = this.eval(node.left);
    const right = this.eval(node.right);

    switch (node.op) {
      case '+':
        return (typeof left === 'string' || typeof right === 'string')
          ? String(left) + String(right)
          : left + right;
      case '-': return left - right;
      case '*': return left * right;
      case '/':
        if (right === 0) throw new Error('Division by zero');
        return left / right;
      case '\\': // modulo
        if (right === 0) throw new Error('Division by zero');
        return Math.floor(left) % Math.floor(right);
      case '%': // random between [left, right), fractions included
        return left + Math.random() * (right - left);
      case '&': // string concatenation
        return String(left) + String(right);
      case '=': case '==': return (left == right) ? 1 : 0;
      case '!=': case '<>': return (left != right) ? 1 : 0;
      case '<':  return (left < right) ? 1 : 0;
      case '>':  return (left > right) ? 1 : 0;
      case '<=': return (left <= right) ? 1 : 0;
      case '>=': return (left >= right) ? 1 : 0;
      case 'AND': return (left && right) ? 1 : 0;
      case 'OR':  return (left || right) ? 1 : 0;
      default:
        throw new Error(`Unknown operator: ${node.op}`);
    }
  }

  evalUnaryOp(node) {
    const operand = this.eval(node.operand);
    switch (node.op) {
      case '-': return -operand;
      case 'NOT': return operand ? 0 : 1;
      default: throw new Error(`Unknown unary operator: ${node.op}`);
    }
  }

  evalCommand(node) {
    const name = node.name;
    const switches = node.switches || [];

    // Check for macro invocation with switches
    if (switches.length > 0 && this.env.isMacro(name)) {
      return this.invokeMacro(name, node.args, switches);
    }

    // Try registered commands first
    const cmd = this.commands.resolve(name);
    if (cmd) {
      // Special handling for INPUT — pass raw AST nodes for variable names
      if (cmd.name === 'INPUT') {
        return cmd.handler(node.args, switches, this);
      }
      // Commands whose arguments are all names: COMPILE TRIANGLES,CT
      if (cmd.name === 'COMPILE') {
        const names = node.args.map(a =>
          (a.type === 'VarRef' || a.type === 'Command') ? a.name : this.eval(a));
        return cmd.handler(names, switches, this);
      }
      // Commands that take a name/identifier as first arg
      const nameFirstCmds = ['SNAP', 'DISPLAY', 'EDIT', 'DELETE', 'ARRAY', 'GOTO', 'ONERROR'];
      if (nameFirstCmds.includes(cmd.name) && node.args.length > 0) {
        let rest = node.args.slice(1);
        const firstArg = node.args[0];
        let nameStr;
        if (firstArg.type === 'VarRef' || firstArg.type === 'Command') {
          nameStr = firstArg.name;
          // ARRAY PYR 10,4 parses as a call of PYR, whose arguments are ARRAY's
          if (firstArg.type === 'Command' && firstArg.args.length > 0) {
            rest = [...firstArg.args, ...rest];
          }
        } else {
          nameStr = this.eval(firstArg);
        }
        const restArgs = rest.map(a => this.eval(a));
        return cmd.handler([nameStr, ...restArgs], switches, this);
      }
      // Evaluate arguments
      const args = node.args.map(a => this.eval(a));
      return cmd.handler(args, switches, this);
    }

    // Check if it's a macro
    if (this.env.isMacro(name)) {
      return this.invokeMacro(name, node.args, switches);
    }

    // Check if it's a variable reference (no args)
    if (node.args.length === 0 && switches.length === 0) {
      const upper = name.toUpperCase();
      // Check if it's a known global, device var, array, or local
      if (this.env.globals.has(upper) ||
          this.env.devices.has(upper) ||
          this.env.arrays.has(upper)) {
        return this.env.get(name);
      }
      // Check locals in current MIB
      const mib = this.env.currentMIB();
      if (mib && mib.locals.has(name.toLowerCase())) {
        return this.env.get(name);
      }
    }

    // An abbreviated macro name: Q runs QUANTIZED$SECOND$DEGREE$SPACE$INVADERS
    // when nothing else starts with Q
    const full = this.env.resolvePrefix(name);
    if (full && this.env.isMacro(full)) {
      return this.invokeMacro(full, node.args, switches);
    }

    throw new Error(`Unknown command: ${name}`);
  }

  evalSequence(node) {
    let result = 0;
    for (const stmt of node.stmts) {
      result = this.eval(stmt);
    }
    return result;
  }

  evalIf(node) {
    const condition = this.eval(node.condition);
    if (condition) {
      return this.eval(node.body);
    }
    return 0;
  }

  // Invoke a macro by name
  invokeMacro(name, argNodes, switches) {
    const body = this.env.get(name);
    if (typeof body !== 'string') {
      throw new Error(`${name} is not a macro`);
    }

    // Evaluate arguments before entering macro
    const args = argNodes.map(a => this.eval(a));

    // Parse macro body into lines
    const lines = splitMacroLines(body);

    // Determine execution mode from switches
    const mode = this.getMacroMode(switches);

    if (mode === 'FG' || mode === 'BG') {
      // Schedule as foreground or background task, with its own locals
      this.scheduler.addTask(mode, name, lines, args, this.env.newMIB(name, args));
      return 1;
    }

    // Middleground / immediate execution — run inline
    return this.runMacroImmediate(name, lines, args);
  }

  // Run a macro immediately (middleground)
  runMacroImmediate(name, lines, args) {
    // Push MIB frame
    this.env.pushMIB(name, args);
    const mib = this.env.currentMIB();
    mib.lines = lines;
    mib.labels = this.parseMacroLabels(lines);

    let result = 0;
    const maxSteps = 100000;
    let steps = 0;
    // GOTO and SKIP in this macro move its own lines, not those of a .B or
    // .F task that called it
    const prevTask = this.currentTask;
    this.currentTask = null;

    try {
      while (mib.pc < lines.length && steps < maxSteps) {
        const line = lines[mib.pc].trim();
        mib.pc++;
        steps++;

        if (line === '' || line.startsWith('.')) continue;

        // Strip label prefix (a label may stand alone on its line)
        const execLine = line.replace(/^\d+\w*(\s+|$)/, '');
        if (execLine.trim() === '') continue;

        try {
          result = this.execLine(execLine);
        } catch (e) {
          if (e.message === 'RETURN') {
            result = e.returnValue !== undefined ? e.returnValue : result;
            break;
          } else if (e.message === 'GOTO') {
            // GOTO modifies mib.pc via the control command
            continue;
          } else if (e.message === 'SKIP') {
            continue;
          } else if (mib.onErrorLabel && mib.labels.has(mib.onErrorLabel.toUpperCase())) {
            // ONERROR label: branch there once, instead of stopping
            mib.pc = mib.labels.get(mib.onErrorLabel.toUpperCase());
            mib.onErrorLabel = null;
            continue;
          } else {
            throw e;
          }
        }
      }
    } finally {
      this.currentTask = prevTask;
      this.env.popMIB();
    }

    return result;
  }

  // Parse labels from macro lines
  parseMacroLabels(lines) {
    const labels = new Map();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const match = line.match(/^(\d+\w*)(\s|$)/);
      if (match) {
        labels.set(match[1].toUpperCase(), i);
      }
    }
    return labels;
  }

  // Determine macro execution mode from switches
  getMacroMode(switches) {
    for (const sw of switches) {
      if (sw === 'F') return 'FG';
      if (sw === 'B') return 'BG';
    }
    return 'MG'; // default middleground
  }

  // Sync device variables to system state
  syncDeviceVar(name, value) {
    const upper = name.toUpperCase();
    if (upper.startsWith('$L') && upper.length === 3) {
      const slot = parseInt(upper[2]);
      if (slot >= 0 && slot <= 3) {
        this.palette.setLeft(slot, Math.floor(value));
      }
    } else if (upper.startsWith('$R') && upper.length === 3) {
      const slot = parseInt(upper[2]);
      if (slot >= 0 && slot <= 3) {
        this.palette.setRight(slot, Math.floor(value));
      }
    } else if (upper === '$HB') {
      this.palette.horizontalBoundary = Math.floor(value);
    }
  }
}
