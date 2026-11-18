// interpreter.js — Tree-walking evaluator + macro execution
// Evaluates AST nodes, dispatches commands, handles macro invocation.

import { tokenize } from './tokenizer.js';
import { parse, Parser } from './parser.js';
import { CommandRegistry } from './commands.js';
import { splitMacroLines } from './script.js';
import { formatValue } from './numfmt.js';
import { registerGraphicsCommands } from './builtins/graphics.js';
import { registerIOCommands } from './builtins/io.js';
import { registerMathCommands } from './builtins/math.js';
import { registerControlCommands } from './builtins/control.js';
import { registerSystemCommands } from './builtins/system.js';

// Commands whose handlers get their arguments as AST nodes, to set variables
// or to take names (ARRDIM FOO,0 names the array FOO, not its value)
const RAW_ARG_COMMANDS = new Set(['INPUT', 'STRING', 'ARRDIM', 'WHATSIS', 'POLYGON', 'PATTERN']);

// Commands whose arguments are all names: COMPILE TRIANGLES,CT and STOP NB
const NAME_ARG_COMMANDS = new Set(['COMPILE', 'STOP']);

// A WHILE run here and now (not one line a turn) stops with an error after
// this many turns, so a loop that never ends can't hang the page
const WHILE_MAX_TURNS = 100000;

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
    this.blockDepth = 0;     // WHILE blocks being run (see evalWhile)
    // $AB=1: command names must be typed whole (RT/1's abbreviation switch)
    this.commands.exactOnly = () => this.env.devices.get('$AB') === 1;

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
    if (String(source).trimStart().startsWith('.')) return null; // a comment
    const ast = parse(tokenize(source));
    // A line that opens with WHILE runs as a middleground macro of that one
    // line, so its loop goes a turn at a time and ESC can stop it
    const first = ast && ast.type === 'Sequence' ? ast.stmts[0] : ast;
    if (first && first.type === 'WhileStmt') {
      return this.scheduler.addTask('MG', 'WHILE', [String(source).trim()], [], null);
    }
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
        return this.scheduler.addTask('MG', name.toUpperCase(), lines, args,
          this.env.newMIB(name, args, this.macroArgNames(ast.args)));
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
        return this.evalVarRef(node);

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

      case 'WhileStmt':
        return this.evalWhile(node);

      case 'IncDec':
        return this.evalIncDec(node);

      case 'Indirect':
        return this.eval(this.indirectTarget(node));

      case 'IndirectAssign':
        return this.evalIndirectAssign(node);

      case 'Paren':
        return this.eval(node.expr);

      case 'LabeledLine':
        return this.evalSequence({ stmts: node.commands });

      default:
        throw new Error(`Unknown AST node type: ${node.type}`);
    }
  }

  // A name used as a value. PI and ANYARGS run as commands there, unless a
  // variable has that name
  evalVarRef(node) {
    const upper = node.name.toUpperCase();
    if (this.commands.valueNames.has(upper) && !this.env.has(node.name)) {
      return this.commands.commands.get(upper)([], [], this);
    }
    return this.env.get(node.name);
  }

  // The name an @ gives: the string its operand evaluates to, which must
  // start with a letter or $ (RT/1's zzind)
  indirectName(node) {
    const name = String(this.eval(node.expr)).trim();
    if (!/^[A-Za-z_$]/.test(name)) throw new Error(`@ needs a name, not "${name}"`);
    return name;
  }

  // What an @ refers to, as a VarRef or ArrayRef node: @S with S="TOM" is
  // TOM, and with S="A(1)" is A(1), as in the glossary's
  // @(ANAME&"("&1&")")
  indirectTarget(node) {
    const name = this.indirectName(node);
    const parser = new Parser(tokenize(name));
    const ref = parser.parseOr();
    if (!parser.atEnd() || (ref.type !== 'VarRef' && ref.type !== 'ArrayRef')) {
      throw new Error(`@ needs a name, not "${name}"`);
    }
    return ref;
  }

  // @S=value: set what @S refers to
  evalIndirectAssign(node) {
    const ref = this.indirectTarget(node.target);
    return ref.type === 'ArrayRef'
      ? this.evalArrayAssign({ name: ref.name, indices: ref.indices, expr: node.expr })
      : this.evalAssign({ name: ref.name, expr: node.expr });
  }

  // The name an argument gives a command that takes names (ARRAY, SNAP,
  // STOP...): the name written, or the one an @ gives. null for neither
  argName(node) {
    if (node.type === 'VarRef' || node.type === 'Command') return node.name;
    if (node.type === 'Indirect') return this.indirectName(node);
    return null;
  }

  // The array an argument names (abbreviated or by @), as { name, arr }, or
  // an error naming `cmd` for anything else
  arrayNamed(node, cmd) {
    const given = this.argName(node);
    if (given !== null) {
      const upper = given.toUpperCase();
      if (this.env.arrays.has(upper)) return { name: upper, arr: this.env.arrays.get(upper) };
      const full = this.env.resolvePrefix(given);
      if (full && this.env.arrays.has(full)) return { name: full, arr: this.env.arrays.get(full) };
    }
    throw new Error(`${cmd} needs an array${given !== null ? `, and ${given} is not one` : ''}`);
  }

  evalAssign(node) {
    const value = this.eval(node.expr);
    this.env.set(node.name, value);

    // Sync device vars to palette if needed
    this.syncDeviceVar(node.name, value);

    return value;
  }

  // NAME(i)=value sets an element of array NAME, which may be abbreviated
  // as when it is read (PY(1)=5 for PYR). A name that is no array is an
  // error, found before anything is evaluated: setting the variable NAME
  // instead, as this once did, hid a missing ARRAY
  evalArrayAssign(node) {
    const upper = node.name.toUpperCase();
    let name = upper;
    if (!this.env.arrays.has(upper)) {
      const full = this.env.resolvePrefix(node.name);
      if (!full || !this.env.arrays.has(full)) {
        throw new Error(`${node.name} is not an array (make it with ARRAY first)`);
      }
      name = full;
    }
    const indices = node.indices.map(i => this.eval(i));
    const value = this.eval(node.expr);
    this.env.setArray(name, indices, value);
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
      if (RAW_ARG_COMMANDS.has(cmd.name)) return cmd.handler(node.indices, [], this);
      if (NAME_ARG_COMMANDS.has(cmd.name)) {
        return cmd.handler(node.indices.map(a => this.argName(a) ?? this.eval(a)), [], this);
      }
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

    // Not an array, a function or a macro: RT/1 had no name to call, and
    // reading it as 0 would hide a misspelling or a missing function
    throw new Error(`Unknown function or array: ${node.name}`);
  }

  evalBinOp(node) {
    const left = this.eval(node.left);
    const right = this.eval(node.right);

    switch (node.op) {
      case '+':
        return (typeof left === 'string' || typeof right === 'string')
          ? formatValue(left) + formatValue(right)
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
      case '&': // string concatenation, numbers as PRINT shows them
        return formatValue(left) + formatValue(right);
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
      case 'ABS': return Math.abs(operand);
      default: throw new Error(`Unknown unary operator: ${node.op}`);
    }
  }

  evalCommand(node) {
    const name = node.name;
    let switches = node.switches || [];

    // Check for macro invocation with switches
    if (switches.length > 0 && this.env.isMacro(name)) {
      return this.invokeMacro(name, node.args, switches);
    }

    // Try registered commands first
    const cmd = this.commands.resolve(name);
    if (cmd) {
      switches = this.commands.checkSwitches(cmd.name, switches);
      // INPUT and STRING get raw AST nodes, for the variables they set
      if (RAW_ARG_COMMANDS.has(cmd.name)) {
        return cmd.handler(node.args, switches, this);
      }
      if (NAME_ARG_COMMANDS.has(cmd.name)) {
        const names = node.args.map(a => this.argName(a) ?? this.eval(a));
        return cmd.handler(names, switches, this);
      }
      // Commands that take a name/identifier as first arg
      const nameFirstCmds = ['SNAP', 'DISPLAY', 'EDIT', 'DELETE', 'ARRAY', 'GOTO', 'ONERROR'];
      if (nameFirstCmds.includes(cmd.name) && node.args.length > 0) {
        let rest = node.args.slice(1);
        const firstArg = node.args[0];
        let nameStr;
        if (firstArg.type === 'Indirect') {
          nameStr = this.indirectName(firstArg); // ARRAY @ANAME,n
        } else if (firstArg.type === 'VarRef' || firstArg.type === 'Command') {
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
    if (node.negate ? !condition : condition) {
      return this.eval(node.body);
    }
    return 0;
  }

  // WHILE condition,{ lines }ENDWHILE. RT/1 ran WHILE as IF and ENDWHILE as
  // SKIP 0 (CMDS.C, COMP.C), with the braces making their lines one line. So
  // a WHILE that opens a macro's line does one turn of the loop and goes back
  // to that line, which is one line run each time round: .B and .F macros
  // carry on between turns and ESC stops it. A WHILE anywhere else (after a
  // ; or IF, inside another WHILE's braces, typed at the prompt with no
  // macro) runs its loop through here and now. GOTO or SKIP in the braces
  // leaves the loop
  evalWhile(node) {
    const task = this.currentTask;
    const mib = task ? null : this.env.currentMIB();
    if (node.first && this.blockDepth === 0 && (task || (mib && mib.lines.length))) {
      if (!this.eval(node.condition)) return 0;
      this.runBlock(node.block);
      if (task) this.scheduler.skip(task, 0);
      else mib.pc -= 1;
      throw new Error('SKIP');
    }
    let turns = 0;
    while (this.eval(node.condition)) {
      if (++turns > WHILE_MAX_TURNS) throw new Error(`WHILE ran ${WHILE_MAX_TURNS} times without ending`);
      this.runBlock(node.block);
    }
    return 0;
  }

  // The lines inside a WHILE's braces, run in order as one line of the macro
  runBlock(source) {
    this.blockDepth++;
    try {
      for (const raw of splitMacroLines(source)) {
        const line = raw.trim();
        if (line === '' || line.startsWith('.')) continue;
        const execLine = line.replace(/^\d+\w*(\s+|$)/, '');
        if (execLine.trim() !== '') this.eval(parse(tokenize(execLine)));
      }
    } finally {
      this.blockDepth--;
    }
  }

  // ++NAME, --NAME: change the variable by 1 and give its new value
  evalIncDec(node) {
    const old = this.env.get(node.name);
    if (typeof old !== 'number') throw new Error(`${node.delta > 0 ? '++' : '--'} needs a number: ${node.name}`);
    const value = old + node.delta;
    this.env.set(node.name, value);
    this.syncDeviceVar(node.name, value);
    return value;
  }

  // Invoke a macro by name
  invokeMacro(name, argNodes, switches) {
    const body = this.env.get(name);
    if (typeof body !== 'string') {
      throw new Error(`${name} is not a macro`);
    }

    // Evaluate arguments before entering macro
    const args = argNodes.map(a => this.eval(a));
    const argNames = this.macroArgNames(argNodes);

    // Parse macro body into lines
    const lines = splitMacroLines(body);

    // Determine execution mode from switches
    const mode = this.getMacroMode(switches);

    if (mode === 'FG' || mode === 'BG') {
      // Schedule as foreground or background task, with its own locals
      this.scheduler.addTask(mode, name, lines, args, this.env.newMIB(name, args, argNames));
      return 1;
    }

    // Middleground / immediate execution — run inline
    return this.runMacroImmediate(name, lines, args, argNames);
  }

  // For each argument to a macro written as a bare name (MAC FOO), that
  // name, else null. INPUT.N takes it as the name, not its value
  macroArgNames(nodes) {
    return nodes.map(a => (a.type === 'VarRef' ||
      (a.type === 'Command' && a.args.length === 0 && !(a.switches || []).length)) ? a.name : null);
  }

  // Run a macro immediately (middleground)
  runMacroImmediate(name, lines, args, argNames) {
    // Push MIB frame
    this.env.pushMIB(name, args, argNames);
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
    // and its WHILEs loop by its own lines, though called from inside a block
    const prevDepth = this.blockDepth;
    this.blockDepth = 0;

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
      this.blockDepth = prevDepth;
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
      // In 8-pixel columns, 0-40: lesson 7's "set $HB to 20 and the screen
      // shows the right half colors $R0-$R3" on the right half
      this.palette.horizontalBoundary = Math.floor(value) * 8;
    }
  }
}
