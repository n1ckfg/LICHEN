// builtins/system.js — HELP, USEMAP, DELETE, COMPILE, EDIT, ARRAY, WHATSIS,
// BEEP, and the string package: LEN, VAL, STR, CHR, ASC, ASCII, SUBSTR,
// STRING, MATCH, REPLACE, LPAD, ANYARGS

import { formatNumber, formatValue } from '../numfmt.js';

// A string argument as text; a number reads as PRINT shows it
const asText = (v) => (v === undefined ? '' : formatValue(v));

export function registerSystemCommands(interp) {
  const reg = interp.commands;

  // HELP — list all commands
  reg.register('HELP', (args, switches, ctx) => {
    ctx.terminal.println('=== LICHEN GRASS Commands ===');
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
    ctx.terminal.println('Assignment: VAR=expr  |  Operators: + - * / \\ % &  ! (abs)  @ (indirect)');
    ctx.terminal.println('Comparison: == # <> < > <= >=  |  Logic: AND && OR || NOT');
    ctx.terminal.println('Strings: [text] {text} "text"  |  Macro: NAME=[code]');
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

  // COMPILE macro, newname — Zgrass compiled for speed. Macros here always run
  // interpreted, so this copies the macro to newname, which then runs the same
  reg.register('COMPILE', (args, switches, ctx) => {
    if (args.length < 2) throw new Error('COMPILE requires macro, newname');
    const src = String(args[0]);
    if (!ctx.env.isMacro(src)) throw new Error(`${src} is not a macro`);
    ctx.env.set(String(args[1]), ctx.env.get(src));
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

  // WHATSIS name — the kind of value name holds, as RT/1's numbers for them:
  // 2 nothing, 4 a whole number, 6 a number with a fraction, 8 a string or
  // macro, 16 an array. WHATSIS.A array — the kind its elements hold, which
  // here is always 6: LICHEN's arrays hold any number. The name is not
  // abbreviated, and is not read, so a macro is not run
  reg.register('WHATSIS', (nodes, switches, ctx) => {
    if (switches.includes('A')) {
      ctx.arrayNamed(nodes[0] ?? { type: 'Number' }, 'WHATSIS.A');
      return 6;
    }
    const name = nodes.length ? ctx.argName(nodes[0]) : null;
    if (name === null) throw new Error('WHATSIS needs a name');
    if (ctx.env.arrays.has(name.toUpperCase())) return 16;
    if (!ctx.env.has(name)) return 2;
    const v = ctx.env.get(name);
    if (typeof v === 'string') return 8;
    return Number.isInteger(v) ? 4 : 6;
  }, 3, ['A']);

  // BEEP — a short tone, where the page can make sound (RT/1 sent the
  // terminal a BEL)
  reg.register('BEEP', (args, switches, ctx) => {
    ctx.terminal.beep();
    return 1;
  }, 3);

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

  // STR — convert number to string, with 6 significant digits as PRINT
  // shows it
  reg.register('STR', (args, switches, ctx) => {
    const v = args[0] ?? 0;
    return typeof v === 'number' ? formatNumber(v) : String(v);
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

  // ASCII n — the one-character string with code n, as CHR (several codes
  // give several characters). ASCII.N s — the code of s's first character, as
  // ASC. ASCII.P n... — print the characters (RT/1 sent them to the printer)
  reg.register('ASCII', (args, switches, ctx) => {
    if (switches.includes('N')) {
      const s = String(args[0] ?? '');
      return s.length > 0 ? s.charCodeAt(0) : 0;
    }
    const text = args.map(a => String.fromCharCode(Math.floor(a || 0))).join('');
    if (switches.includes('P')) {
      ctx.terminal.print(text);
      return 1;
    }
    return text;
  }, 4, ['N', 'P']); // ASCI, so that ASC is still ASC

  // SUBSTR s, beg, end — characters beg to end of s, counting from 0, both
  // included. end past the string stops at its end, and beg after end gives
  // an empty string (RT/1's CM2.C)
  reg.register('SUBSTR', (args, switches, ctx) => {
    const s = String(args[0] ?? '');
    const beg = Math.max(0, Math.floor(args[1] || 0));
    const end = Math.min(s.length - 1, Math.floor(args[2] ?? s.length - 1));
    return beg > end ? '' : s.slice(beg, end + 1);
  }, 4);

  // MATCH(big, sub) — where sub first starts in big, counting from 0, or -1
  // when it isn't there. Capitals and small letters differ (RT/1 glossary)
  reg.register('MATCH', (args) => {
    return asText(args[0]).indexOf(asText(args[1]));
  }, 3);

  // REPLACE(big, sub, rep) — big with rep wherever sub was. REPLACE.O puts
  // it in at the first place only. An empty sub replaces nothing
  reg.register('REPLACE', (args, switches) => {
    const [big, sub, rep] = [asText(args[0]), asText(args[1]), asText(args[2])];
    if (sub === '') return big;
    return switches.includes('O') ? big.replace(sub, () => rep) : big.split(sub).join(rep);
  }, 3, ['O']);

  // LPAD(s, char, width) — s lengthened to width with char added at its
  // start, which lines numbers up on the right. .R adds them at the end, .C
  // at both ends (the odd one at the end). s already as wide stays as it is
  reg.register('LPAD', (args, switches) => {
    const s = asText(args[0]);
    const ch = asText(args[1])[0] ?? ' ';
    const extra = Math.max(0, Math.floor(args[2] || 0) - s.length);
    if (switches.includes('R')) return s + ch.repeat(extra);
    if (switches.includes('C')) {
      const before = Math.floor(extra / 2);
      return ch.repeat(before) + s + ch.repeat(extra - before);
    }
    return ch.repeat(extra) + s;
  }, 2, ['R', 'C']);

  // STRING s, ix — the code of the character at ix in s. STRING s, ix, c1,
  // c2... — write the codes c1, c2... into s from ix on, as far as its end,
  // and return the last one written. s keeps its length. The arguments come
  // as AST nodes, so a variable written to is set again with its new string
  reg.register('STRING', (nodes, switches, ctx) => {
    if (nodes.length < 2) throw new Error('STRING requires string, index');
    const target = nodes[0];
    const s = String(ctx.eval(target));
    let ix = Math.floor(ctx.eval(nodes[1]) || 0);
    if (ix < 0 || ix > s.length - 1) throw new Error('STRING index out of range');
    const codes = nodes.slice(2).map(n => Math.floor(ctx.eval(n) || 0));
    if (codes.length === 0) return s.charCodeAt(ix);
    const chars = s.split('');
    let last = 0;
    for (const c of codes) {
      if (ix >= chars.length) break;
      chars[ix++] = String.fromCharCode(c);
      last = c;
    }
    if (target.type === 'VarRef' || (target.type === 'Command' && target.args.length === 0)) {
      ctx.env.set(target.name, chars.join(''));
    }
    return last;
  }, 4);

  // ANYARGS — 1 if the macro it is in has arguments still to take, else 0.
  // Arguments let a macro skip its PROMPTs (lesson 6), and this tells it so.
  // Works as a bare name in an expression: IF ANYARGS,SKIP 2
  reg.register('ANYARGS', (args, switches, ctx) => {
    const mib = ctx.env.currentMIB();
    return mib && mib.args.length > mib.argIndex ? 1 : 0;
  }, 3);
  reg.valueNames.add('ANYARGS');
  reg.valueNames.add('PI');
}
