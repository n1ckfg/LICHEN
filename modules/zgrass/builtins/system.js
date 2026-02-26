// builtins/system.js — HELP, USEMAP, DELETE, COMPILE, EDIT, ARRAY

export function registerSystemCommands(interp) {
  const reg = interp.commands;

  // HELP — list all commands
  reg.register('HELP', (args, switches, ctx) => {
    ctx.terminal.println('=== LICHEN ZGRASS Commands ===');
    const cmds = ctx.commands.list();
    // Display in columns
    let line = '';
    for (let i = 0; i < cmds.length; i++) {
      line += cmds[i].padEnd(12);
      if ((i + 1) % 6 === 0) {
        ctx.terminal.println(line);
        line = '';
      }
    }
    if (line.length > 0) ctx.terminal.println(line);
    ctx.terminal.println('');
    ctx.terminal.println('Assignment: VAR:expr  |  Operators: + - * / \\ % &');
    ctx.terminal.println('Comparison: == != < > <= >=  |  Logic: AND OR NOT');
    ctx.terminal.println('Strings: [text] {text} "text"  |  Macro: NAME:[code]');
    ctx.terminal.println('.B=background .F=foreground  |  ESC=break');
    return 1;
  }, 1);

  // USEMAP — list all user-defined names
  reg.register('USEMAP', (args, switches, ctx) => {
    const names = ctx.env.getUserNames();
    if (names.length === 0) {
      ctx.terminal.println('No user-defined names');
    } else {
      let line = '';
      for (let i = 0; i < names.length; i++) {
        const val = ctx.env.get(names[i]);
        const type = typeof val === 'string' ? 'M' : 'V';
        line += `${names[i]}(${type})`.padEnd(16);
        if ((i + 1) % 4 === 0) {
          ctx.terminal.println(line);
          line = '';
        }
      }
      if (line.length > 0) ctx.terminal.println(line);
    }
    return 1;
  }, 1);

  // DELETE name — remove a variable or macro
  reg.register('DELETE', (args, switches, ctx) => {
    if (args.length === 0) throw new Error('DELETE requires a name');
    const name = String(args[0]);
    ctx.env.delete(name);
    ctx.sprites.delete(name);
    return 1;
  }, 2);

  // COMPILE macro, newname — compile for speed (stub/no-op)
  reg.register('COMPILE', (args, switches, ctx) => {
    ctx.terminal.println('COMPILE: not implemented (macros run interpreted)');
    return 1;
  }, 3);

  // EDIT name — open full-screen editor for a macro
  reg.register('EDIT', (args, switches, ctx) => {
    if (args.length === 0) throw new Error('EDIT requires a macro name');
    const name = String(args[0]).toUpperCase();
    let body = '';
    const val = ctx.env.get(name);
    if (typeof val === 'string') {
      body = val;
      // Strip outer brackets
      if (body.startsWith('[') && body.endsWith(']')) {
        body = body.slice(1, -1);
      } else if (body.startsWith('{') && body.endsWith('}')) {
        body = body.slice(1, -1);
      }
    }

    // Open the editor (accessed via the interpreter's reference chain)
    // The editor is on the REPL's terminal's parent — we access it via ctx
    if (ctx._editor) {
      ctx._editor.open(name, body, (savedName, savedBody) => {
        ctx.env.set(savedName, savedBody);
      });
    } else {
      ctx.terminal.println('Editor not available');
    }
    return 1;
  }, 2);

  // ARRAY name, size [, size2] — create a numeric array
  reg.register('ARRAY', (args, switches, ctx) => {
    if (args.length < 2) throw new Error('ARRAY requires name, size');
    const name = String(args[0]);
    if (args.length === 2) {
      ctx.env.createArray(name, Math.floor(args[1]));
    } else {
      ctx.env.createArray(name, Math.floor(args[1]), Math.floor(args[2]));
    }
    return 1;
  }, 2);

  // LEN — get length of string or array
  reg.register('LEN', (args, switches, ctx) => {
    if (args.length === 0) return 0;
    const val = args[0];
    if (typeof val === 'string') return val.length;
    return 0;
  }, 2);

  // VAL — convert string to number
  reg.register('VAL', (args, switches, ctx) => {
    if (args.length === 0) return 0;
    const n = parseFloat(String(args[0]));
    return isNaN(n) ? 0 : n;
  }, 2);

  // STR — convert number to string
  reg.register('STR', (args, switches, ctx) => {
    return String(args[0] ?? 0);
  }, 2);

  // CHR — convert number to character
  reg.register('CHR', (args, switches, ctx) => {
    return String.fromCharCode(Math.floor(args[0] || 0));
  }, 2);

  // ASC — convert character to number
  reg.register('ASC', (args, switches, ctx) => {
    const s = String(args[0] || '');
    return s.length > 0 ? s.charCodeAt(0) : 0;
  }, 2);
}
