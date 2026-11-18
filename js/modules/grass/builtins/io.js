// builtins/io.js — PRINT, INPUT, PROMPT

import { formatValue } from '../numfmt.js';

export function registerIOCommands(interp) {
  const reg = interp.commands;

  // PRINT expr, ... — print the values to the terminal, a space between them,
  // then a NEXTLINE. Returns 1
  reg.register('PRINT', (args, switches, ctx) => {
    if (args.length === 0) {
      if (!switches.some(s => s.includes('N'))) ctx.terminal.println('');
    } else {
      // .S: no space between the things, .N: and no NEXTLINE either (RT/1)
      const output = args.map(formatValue).join(switches.length ? '' : ' ');
      if (switches.some(s => s.includes('N'))) ctx.terminal.print(output);
      else ctx.terminal.println(output);
    }
    return 1;
  }, 1, ['S', 'N']);

  // PROMPT "text" — print prompt text (suppressed when macro has args)
  reg.register('PROMPT', (args, switches, ctx) => {
    const mib = ctx.env.currentMIB();
    // Suppress prompt when arguments were passed to the macro
    if (mib && mib.args.length > 0 && mib.argIndex < mib.args.length) {
      return 1;
    }
    // Like PRINT, a space after each thing, but no NEXTLINE
    if (args.length > 0) {
      ctx.terminal.print(args.map(a => formatValue(a) + ' ').join(''));
    }
    return 1;
  }, 2);

  // INPUT var1, var2, ... — get values from macro args or the user
  // Receives raw AST nodes so we can extract variable names.
  // In a running macro with no arguments left, the macro waits for a typed
  // line. Its values are separated by commas, as in lesson 8's 0,50,0,0,4,
  // and fill the variables in order. Too few and the next is asked for; too
  // many and the rest wait for the macro's next INPUT. INPUT.STR takes the
  // line whole as a string. All the variables are set at once, when there are
  // enough values, and then the rest of the line runs.
  // INPUT.N is INPUT.STR, except that an argument passed as a bare name
  // (MAC FOO) gives the name FOO, not its value, so a macro can take names
  // as RT/1's commands do. INPUT.F first throws away what was typed ahead:
  // answers kept for a later INPUT, and the key in $CH (RT/1)
  reg.register('INPUT', (astNodes, switches, ctx) => {
    const mib = ctx.env.currentMIB();
    const task = ctx.currentTask;
    const has = (letter) => switches.some(s => s !== 'STR' && s.includes(letter));
    const byName = has('N');
    const asString = switches.includes('STR') || byName;
    // Not on a line run again after an answer, which would throw it away
    if (has('F') && !(task && task._inputFrom !== undefined)) {
      ctx.env.setDevice('$CH', 0);
      if (task) task._inputValues = [];
    }

    // Extract variable names; an array element such as CHECKERBOARD(X,Y) is
    // set through its array
    const targets = [];
    for (const node of astNodes) {
      if (node.type === 'VarRef' || node.type === 'Command' || node.type === 'Indirect') {
        const name = ctx.argName(node);
        targets.push({ name, store: (v) => ctx.env.set(name, v) });
      } else if (node.type === 'ArrayRef' && ctx.env.arrays.has(node.name.toUpperCase())) {
        const indices = node.indices.map(i => ctx.eval(i));
        targets.push({ name: node.name, store: (v) => ctx.env.setArray(node.name, indices, v) });
      } else {
        ctx.eval(node);
      }
    }

    // Values passed to the macro come first. On a line run again after the
    // user answered, those were already taken
    let k;
    if (task && task._inputFrom !== undefined) {
      k = task._inputFrom;
    } else {
      k = 0;
      while (k < targets.length && mib && mib.args.length > mib.argIndex) {
        const i = mib.argIndex++;
        targets[k++].store(byName ? (mib.argNames[i] ?? mib.args[i]) : mib.args[i]);
      }
    }
    if (task) delete task._inputFrom;
    const rest = targets.slice(k);
    if (rest.length === 0) return 1;

    if (task) {
      const typed = task._inputValues || (task._inputValues = []);
      if (typed.length >= rest.length) {
        rest.forEach((t, i) => t.store(typed[i]));
        typed.splice(0, rest.length);
        return 1;
      }
      // Wait for the user, then run this line again
      task._inputFrom = k;
      task._waitingForInput = true;
      task.pc--;
      ctx.repl.requestInput(`${rest[typed.length].name}? `, (line) => {
        typed.push(...parseInputLine(line, asString));
        task._waitingForInput = false;
      });
      throw new Error('INPUT_WAIT');
    }

    // Typed at the prompt, or in a macro another one called inline: nothing
    // can wait here, so the variables get 0
    for (const t of rest) {
      t.store(0);
      ctx.terminal.println(`(INPUT ${t.name}: no input here; run the macro by name to type values)`);
    }
    return 1;
  }, 1, ['STR', 'N', 'F']);
}

// A typed answer: numbers where they parse, else strings
function parseInputLine(line, asString) {
  if (asString) return [line];
  return line.split(',').map(s => s.trim()).map(s => {
    const n = Number(s);
    return s !== '' && !isNaN(n) ? n : (s === '' ? 0 : s);
  });
}
