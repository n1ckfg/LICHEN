// script.js — .grass script files: split a script into the commands it holds,
// and write the workspace back out as one.
//
// A .grass file is what you would type at the attention mark, one command per
// line. A string in [] or {} may run over several lines, as a macro does
// (Q=[BOX 0,0,100,100,2<newline>BOX 50,50,100,100,3]), so its NEXTLINEs stay
// inside the command. Quotes can't nest, and at the top level they end with the
// line, so one stray quote can't swallow the rest of the file.

// A macro's lines, as GOTO, SKIP and .B interleaving count them. A quoted
// string may run over several lines inside a macro (CHOOSY's PRINT, lesson 7),
// and then those lines are one. Blank lines still count, as in Zgrass
export function splitMacroLines(body) {
  return splitScript(body, { quotesSpanLines: true, keepBlank: true }).map(c => c.text.trim());
}

// Split script text into commands, each with the 1-based line it starts on
export function splitScript(text, { quotesSpanLines = false, keepBlank = false } = {}) {
  const src = String(text).replace(/\r\n?/g, '\n');
  const commands = [];
  let start = 0;
  let line = 1;
  let startLine = 1;
  let depth = 0;      // [] and {} nesting
  let quote = null;   // open " or ' at the top level

  const flush = (end) => {
    const cmd = src.slice(start, end).replace(/\s+$/, '');
    if (keepBlank || cmd.trim() !== '') commands.push({ line: startLine, text: cmd });
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\n') {
      line++;
      if (depth === 0 && (!quote || !quotesSpanLines)) {
        quote = null;
        flush(i);
        start = i + 1;
        startLine = line;
      }
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '[' || ch === '{') depth++;
    else if ((ch === ']' || ch === '}') && depth > 0) depth--;
    else if (depth === 0 && (ch === '"' || ch === "'")) quote = ch;
  }
  flush(src.length);
  return commands;
}

// Delimit a string so the tokenizer reads it back unchanged
export function quoteString(s) {
  const balanced = (open, close) => {
    let d = 0;
    for (const ch of s) {
      if (ch === open) d++;
      else if (ch === close && --d < 0) return false;
    }
    return d === 0;
  };
  if (balanced('[', ']')) return '[' + s + ']';
  if (balanced('{', '}')) return '{' + s + '}';
  if (!s.includes('"') && !s.includes('\n')) return '"' + s + '"';
  if (!s.includes("'") && !s.includes('\n')) return "'" + s + "'";
  return null;
}

// Write the user's names out as a script that LOADing restores them from:
// macros and strings, numbers, and arrays with their non-zero elements.
// Returns { text, skipped } where skipped lists names that couldn't be written.
export function serializeWorkspace(env) {
  const out = [];
  const skipped = [];
  for (const [name, value] of env.globals) {
    if (typeof value === 'string') {
      const q = quoteString(value);
      if (q === null) { skipped.push(name); continue; }
      out.push(`${name}=${q}`);
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      out.push(`${name}=${value}`);
    } else {
      skipped.push(name);
    }
  }
  for (const [name, arr] of env.arrays) {
    out.push(`ARRAY ${name},${arr.dimensions.join(',')}`);
    const cols = arr.dimensions.length === 2 ? arr.dimensions[1] : 0;
    for (let i = 0; i < arr.data.length; i++) {
      const v = arr.data[i];
      if (v === 0) continue;
      const idx = cols ? `${Math.floor(i / cols)},${i % cols}` : `${i}`;
      out.push(`${name}(${idx})=${v}`);
    }
  }
  return { text: out.length ? out.join('\n') + '\n' : '', skipped };
}
