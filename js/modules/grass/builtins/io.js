// builtins/io.js — PRINT, INPUT, PROMPT

export function registerIOCommands(interp) {
  const reg = interp.commands;

  // PRINT expr — print value to terminal, returns 1
  reg.register('PRINT', (args, switches, ctx) => {
    if (args.length === 0) {
      ctx.terminal.println('');
    } else {
      const output = args.map(a => String(a)).join(' ');
      ctx.terminal.println(output);
    }
    return 1;
  }, 1);

  // PROMPT "text" — print prompt text (suppressed when macro has args)
  reg.register('PROMPT', (args, switches, ctx) => {
    const mib = ctx.env.currentMIB();
    // Suppress prompt when arguments were passed to the macro
    if (mib && mib.args.length > 0 && mib.argIndex < mib.args.length) {
      return 1;
    }
    // Like PRINT, a space after each thing, but no NEXTLINE
    if (args.length > 0) {
      ctx.terminal.print(args.map(a => String(a) + ' ').join(''));
    }
    return 1;
  }, 2);

  // INPUT var1, var2, ... — get values from macro args or user
  // Receives raw AST nodes so we can extract variable names.
  reg.register('INPUT', (astNodes, switches, ctx) => {
    const mib = ctx.env.currentMIB();

    for (const node of astNodes) {
      // Extract variable name from AST node; an array element such as
      // CHECKERBOARD(X,Y) is set through its array
      let varName;
      let store;
      if (node.type === 'VarRef' || node.type === 'Command') {
        varName = node.name;
        store = (v) => ctx.env.set(varName, v);
      } else if (node.type === 'ArrayRef' && ctx.env.arrays.has(node.name.toUpperCase())) {
        varName = node.name;
        const indices = node.indices.map(i => ctx.eval(i));
        store = (v) => ctx.env.setArray(varName, indices, v);
      } else {
        ctx.eval(node);
        continue;
      }

      // Check if macro has remaining arguments to consume
      if (mib && mib.args.length > mib.argIndex) {
        const val = mib.args[mib.argIndex++];
        store(val);
      } else if (ctx.currentTask) {
        // For scheduled tasks, pause the task and request input via REPL
        const task = ctx.currentTask;
        task.pc--; // Re-execute this line when we get input
        task._waitingForInput = true;
        task._inputVarName = varName;

        ctx.repl.requestInput(`${varName}? `, (value) => {
          const num = parseFloat(value);
          store(isNaN(num) ? value : num);
          task._waitingForInput = false;
          task.pc++; // Skip past the INPUT line now
        });
        return 1;
      } else {
        // Immediate mode — request input via REPL
        // This can't truly block, so we set variable to 0 for now
        // Interactive input in immediate mode would need async/await
        store(0);
        ctx.terminal.println(`(INPUT ${varName}: interactive input in immediate mode not yet supported)`);
      }
    }

    return 1;
  }, 1);
}
