// Regression runner for the GRASS module, headless in Node.
//
// Usage: node tools/grass-lessons.mjs [--update] [--frames N] [--verbose]
//
// For each lesson in files/grass/ it loads the script into a new GrassSession,
// steps it N frames (default 600, ten seconds at 60 Hz), answers any INPUT,
// and checks:
//   - nothing printed an ERROR
//   - the screen at the end matches tools/grass-lessons.baseline.json (random
//     numbers, the clock and the frame's time budget are made deterministic,
//     so the same code always draws the same picture). --update rewrites it
//   - Save then Load gives back the same workspace
// Then it checks the drawing primitives and modifiers directly: XOR drawing
// twice leaves nothing behind, one XOR draw of a shape touches as many pixels
// as PLOP does, and the commands added from RT/1 behave as RT/1's did.
//
// Exits non-zero if any check fails.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Deterministic clock, timezone, random numbers and frame budget. Set before
// the GRASS modules load
process.env.TZ = 'UTC';
const FIXED_NOW = Date.UTC(1981, 0, 1, 12, 0, 0);
let fakeNow = FIXED_NOW;
Date.now = () => fakeNow;
let seed = 1;
Math.random = () => {
  // mulberry32
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
Object.defineProperty(globalThis, 'performance', { value: { now: () => 0 }, configurable: true });

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const { GrassSession } = await import(path.join(root, 'js/modules/grass/session.js'));
const { serializeWorkspace } = await import(path.join(root, 'js/modules/grass/script.js'));

const argv = process.argv.slice(2);
const UPDATE = argv.includes('--update');
const VERBOSE = argv.includes('--verbose');
const fi = argv.indexOf('--frames');
const FRAMES = fi >= 0 ? parseInt(argv[fi + 1], 10) : 600;
const BASELINE = path.join(here, 'grass-lessons.baseline.json');

let failures = 0;
const fail = (msg) => { failures++; console.log('  FAIL ' + msg); };
const ok = (msg) => { if (VERBOSE) console.log('  ok   ' + msg); };
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));

// A session whose terminal output is all kept, however much scrolls off
function newSession() {
  const s = new GrassSession();
  const log = [];
  const println = s.terminal.println.bind(s.terminal);
  const print = s.terminal.print.bind(s.terminal);
  s.terminal.println = (t) => { log.push(String(t)); println(t); };
  s.terminal.print = (t) => { log.push(String(t)); print(t); };
  s.log = log;
  return s;
}

// Step a session n frames, answering INPUT with `answer`
function step(s, n, answer = '0,100,5') {
  for (let i = 0; i < n; i++) {
    if (s.repl.isWaitingForInput()) {
      s.repl.inputBuffer = answer;
      s.repl.handleKey('', 13, { ENTER: 13 });
    }
    fakeNow += 1000 / 60;
    s.frame();
  }
}

const hash = (u8) => crypto.createHash('sha1').update(u8).digest('hex').slice(0, 16);
const lit = (fb) => fb.pixels.reduce((n, v) => n + (v ? 1 : 0), 0);
const errorsIn = (log) => log.filter(l => /\bERROR\b/.test(l));

// Run one command line in a session right away, reporting what it printed
function run(s, line) {
  const before = s.log.length;
  try {
    s.interpreter.execTopLevel(line);
  } catch (e) {
    s.log.push('ERROR: ' + e.message);
  }
  return s.log.slice(before);
}

// ---------------------------------------------------------------- lessons
const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : {};
const newBaseline = {};
const lessonDir = path.join(root, 'files/grass');
const lessons = fs.readdirSync(lessonDir).filter(f => f.endsWith('.grass')).sort();

console.log(`Lessons (${FRAMES} frames each)`);
for (const file of lessons) {
  seed = 1;
  fakeNow = FIXED_NOW;
  const s = newSession();
  s.load(fs.readFileSync(path.join(lessonDir, file), 'utf8'), file);
  step(s, FRAMES);
  const errs = errorsIn(s.log);
  const h = hash(s.framebuffer.pixels);
  newBaseline[file] = h;
  console.log(`${file}: ${errs.length} errors, screen ${h}${s.isRunning() ? ', running' : ''}`);
  check(errs.length === 0, `${file} runs without errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
  if (baseline[file] && !UPDATE) {
    check(baseline[file] === h, `${file} screen matches the baseline (${baseline[file]})`);
  }

  // Save, then Load into a fresh session: the same workspace comes back
  const { text, skipped } = serializeWorkspace(s.env);
  const t = newSession();
  t.load(text, 'saved');
  step(t, 5);
  const again = serializeWorkspace(t.env).text;
  check(again === text && skipped.length === 0,
    `${file} saves and loads back identical (${s.env.globals.size} names, ${s.env.arrays.size} arrays)`);
  check(errorsIn(t.log).length === 0, `${file} saved workspace loads without errors`);
}

if (UPDATE) {
  fs.writeFileSync(BASELINE, JSON.stringify(newBaseline, null, 2) + '\n');
  console.log(`Wrote ${path.relative(root, BASELINE)}`);
}

// ---------------------------------------------------------------- primitives
console.log('Primitives and modifiers');

// Draw `cmd` (with {cm} for the colormode) once in PLOP and once, then twice,
// in XOR, under the modifier lines `mods`
function xorCheck(label, cmd, mods = []) {
  const plop = newSession();
  mods.forEach(m => run(plop, m));
  run(plop, cmd.replace('{cm}', '3'));
  const xor = newSession();
  mods.forEach(m => run(xor, m));
  run(xor, cmd.replace('{cm}', '7'));
  const once = lit(xor.framebuffer);
  run(xor, cmd.replace('{cm}', '7'));
  const twice = lit(xor.framebuffer);
  const errs = [...errorsIn(plop.log), ...errorsIn(xor.log)];
  check(errs.length === 0, `${label}: no errors${errs.length ? ': ' + errs[0] : ''}`);
  check(twice === 0, `${label}: XOR twice leaves nothing (${twice} left)`);
  return { plop: lit(plop.framebuffer), xor: once };
}

for (const r of [1, 5, 20, 60]) {
  const { plop, xor } = xorCheck(`CIRCLE r=${r}`, `CIRCLE 0,0,${r},${r},{cm}`);
  check(plop === xor, `CIRCLE r=${r}: one XOR draw lights every pixel PLOP does (${xor}/${plop})`);
}
{
  const { plop, xor } = xorCheck('ellipse', 'CIRCLE 10,-5,70,30,{cm}');
  check(plop === xor, `ellipse: one XOR draw lights every pixel PLOP does (${xor}/${plop})`);
}
xorCheck('BOX', 'BOX 0,0,51,31,{cm}');
xorCheck('LINE', 'MOVE -100,-80;LINE 120,70,{cm}');
xorCheck('POINT', 'POINT 5,5,{cm}');
xorCheck('fat LINE', 'MOVE -100,-80;LINE 120,70,{cm},6');

const px = (s, x, y) => s.framebuffer.getPixel(x, y);
const fresh = (...lines) => { const s = newSession(); lines.forEach(l => run(s, l)); return s; };

// Modifiers: XOR twice still clears under each, alone and stacked
const MODS = {
  'MIRROR.X': ['MIRROR.X'],
  'MIRROR.XY 10,-5': ['MIRROR.XY 10,-5'],
  'MULTI 40,30': ['MULTI 40,30'],
  'MULTI.XYH 40,30': ['MULTI.XYH 40,30'],
  'KALIEDOSCOPE 6': ['KALIEDOSCOPE 6'],
  'KALIEDOSCOPE.C 0,5': ['KALIEDOSCOPE.C 0,5'],
  'SPHERE 0,0,60': ['SPHERE 0,0,60'],
  'CORNER 100,50': ['CORNER 100,50'],
  'MIRROR.X + MULTI 80,0': ['MIRROR.X', 'MULTI 80,0'],
};
for (const [name, mods] of Object.entries(MODS)) {
  for (const [label, cmd] of [['BOX', 'BOX 30,20,41,21,{cm}'], ['CIRCLE', 'CIRCLE 20,10,30,20,{cm}'],
    ['LINE', 'MOVE -90,-60;LINE 100,70,{cm}']]) {
    xorCheck(`${label} under ${name}`, cmd, mods);
  }
}

{
  const s = fresh('MIRROR.X', 'POINT 10,5,3');
  check(px(s, 10, 5) === 3 && px(s, -10, 5) === 3 && lit(s.framebuffer) === 2, 'MIRROR.X reflects across x = 0');
  const t = fresh('MIRROR.XY 0,0', 'POINT 10,5,3');
  check([[10, 5], [-10, 5], [10, -5], [-10, -5]].every(([x, y]) => px(t, x, y) === 3) && lit(t.framebuffer) === 4,
    'MIRROR.XY draws four copies');
  const u = fresh('MIRROR.X', 'POINT 0,5,7');
  check(px(u, 0, 5) === 0, 'MIRROR.X: an XOR dot on the axis cancels itself, as on RT/1');
  const v = fresh('CENTER 20,0', 'MIRROR.X', 'POINT 10,0,3');
  check(px(v, 10, 0) === 3 && px(v, -10, 0) === 3, 'MIRROR centres on the CENTER');
  const w = fresh('MIRROR.X', 'MIRROR.Y', 'POINT 10,5,3');
  check(w.framebuffer.modifiers.length === 1 && lit(w.framebuffer) === 2,
    'MIRROR set up again replaces the first, in its place');
}
{
  const s = fresh('MULTI 40,0', 'POINT 0,0,3');
  check(lit(s.framebuffer) === 8, `MULTI 40,0 repeats across the screen (${lit(s.framebuffer)}/8)`);
  const t = fresh('MULTI 40,40', 'POINT 0,0,3');
  check(lit(t.framebuffer) === 40, `MULTI 40,40 tiles the screen (${lit(t.framebuffer)}/40)`);
  const u = fresh('MULTI.C 1,40,0', 'POINT 0,0,3');
  check(px(u, 0, 0) === 3 && px(u, 40, 0) === 1, 'MULTI.C draws the copies in another colormode');
  const v = fresh('MULTI 40,40', 'MULTI', 'POINT 0,0,3');
  check(lit(v.framebuffer) === 1, 'MULTI on its own stops repeating');
}
{
  const s = fresh('KALIEDOSCOPE 4', 'POINT 50,0,3');
  check(lit(s.framebuffer) === 4, `KALIEDOSCOPE 4 draws four copies (${lit(s.framebuffer)})`);
  const t = fresh('KALEIDOSCOPE 4', 'POINT 50,0,3');
  check(lit(t.framebuffer) === 4, 'KALEIDOSCOPE spelled the usual way works too');
  const u = fresh('KAL.C 0,4', 'POINT 30,30,3', 'POINT -30,30,3');
  check(lit(u.framebuffer) === 4, `KALIEDOSCOPE.C keeps only the first slice (${lit(u.framebuffer)}/4)`);
  const v = fresh('KAL 4', 'KILL', 'POINT 50,0,3');
  check(lit(v.framebuffer) === 1 && v.framebuffer.modifiers.length === 0, 'KILL stops every modifier');
}
{
  const s = fresh('SPHERE 0,0,50', 'BOX 0,0,320,201,3');
  const fb = s.framebuffer;
  let far = 0;
  for (let i = 0; i < fb.pixels.length; i++) {
    if (fb.pixels[i] && Math.hypot((i % 320) - 160, Math.floor(i / 320) - 100) > 52) far++;
  }
  check(lit(fb) > 1000 && far === 0, `SPHERE 0,0,50 maps the screen into its disc (${lit(fb)} lit, ${far} outside)`);
  const t = fresh('CORNER 100,50', 'BOX 0,0,320,201,3');
  check(lit(t.framebuffer) === 320 * 201 - 100 * 50, 'CORNER 100,50 masks the lower right corner');
  check(px(t, 159, -100) === 0 && px(t, 159, 100) === 3 && px(t, -160, -100) === 3, 'CORNER masks only the lower right');
}
{
  const s = fresh('CENTER 50,20', 'POINT 0,0,3');
  check(s.framebuffer.pixels[(100 - 20) * 320 + 160 + 50] === 3 && px(s, 0, 0) === 3,
    'CENTER moves the origin for drawing and reading');
  const d = fresh('BOX 50,0,10,10,3', 'SNAP S,50,0,10,10', 'CLEAR', 'MIRROR.X', 'DISPLAY S,50,0,0');
  check(lit(d.framebuffer) === 200 && px(d, -50, 0) === 3, 'DISPLAY goes through the modifiers, as on RT/1');
}

// FILL
{
  const s = fresh('BOX 0,0,51,31,1', 'FILL 0,0,2');
  check(lit(s.framebuffer) === 51 * 31 && px(s, 0, 0) === 2 && px(s, 25, 15) === 2, 'FILL fills a box and stops at its edge');
  const t = fresh('CIRCLE 0,0,30,30,3', 'FILL 0,0,1');
  check(px(t, 0, 0) === 1 && px(t, 0, 40) === 0 && px(t, 20, 0) === 1, 'FILL stays inside a CIRCLE outline');
  const u = fresh('BOX 0,0,51,31,1', 'FILL 0,0,6', 'FILL 0,0,6');
  check(px(u, 0, 0) === 1 && lit(u.framebuffer) === 51 * 31, 'XOR FILL twice gives the area back');
  const v = fresh('FILL.L 0,0,3,4');
  check(lit(v.framebuffer) === 320 * 51, `FILL.L fills with lines (${lit(v.framebuffer)})`);
  const w = fresh('PRINT FILL(500,0,3)');
  check(w.log.includes('-1'), 'FILL off the screen returns -1');
  const f = fresh('MOVE -50,0', 'LINE 50,0,3,5');
  check([-2, -1, 0, 1, 2].every(y => px(f, 0, y) === 3) && px(f, 0, 3) === 0 && px(f, 0, -3) === 0,
    'LINE with thickness 5 is 5 pixels wide');
}

// Numbers, strings, timers, ANYARGS, $AB
{
  const s = fresh('PRINT 100/3', 'PRINT STR(1/3)', 'PRINT "A"&(2/3)', 'PRINT SIN(30)', 'PRINT 7', 'PRINT PI',
    'X=PI;PRINT X', 'IF PI,PRINT "YES"');
  for (const want of ['33.3333', '0.333333', 'A0.666667', '0.5', '7', '3.14159', 'YES']) {
    check(s.log.includes(want), `prints ${want}`);
  }
  check(s.log.filter(l => l === '3.14159').length === 2, 'PI works as a bare name in an expression');
  const r = newSession();
  run(r, 'X=100/3');
  const saved = serializeWorkspace(r.env).text;
  check(saved === `X=${100 / 3}\n`, 'Save keeps every digit');
}
{
  const s = fresh('PRINT SUBSTR("HELLO",1,3)', 'PRINT SUBSTR("HELLO",3,99)', 'PRINT LEN(SUBSTR("HELLO",4,2))',
    'S="HELLO"', 'PRINT STRING(S,1)', 'STRING S,0,74', 'PRINT S', 'PRINT STRING(S,3,33,33,33)', 'PRINT S',
    'PRINT ASCII(72)', 'ASCII.P 72,73');
  for (const want of ['ELL', 'LO', '0', '69', 'JELLO', '33', 'JEL!!', 'H', 'HI']) {
    check(s.log.includes(want), `string package prints ${want}`);
  }
  const t = fresh('S="AB"', 'STRING S,5');
  check(errorsIn(t.log).length === 1, 'STRING past the end is an error');
}
{
  const s = newSession();
  run(s, 'M=[IF ANYARGS,PRINT "ARGS"\nIF ANYARGS==0,PRINT "NONE"]');
  s.queue.push({ text: 'M 5' }, { text: 'M' });
  step(s, 10);
  const i = s.log.indexOf('ARGS');
  check(i >= 0 && s.log.indexOf('NONE') > i, 'ANYARGS tells whether a macro has arguments');
}
{
  const s = newSession();
  run(s, '$Z0=30');
  run(s, '$Z9=5');
  const tk = s.env.get('$TK');
  step(s, 10);
  check(s.env.get('$Z0') === 20 && s.env.get('$Z9') === 0 && s.env.get('$TK') === tk + 10,
    `$Z0-$Z9 count down and $TK up a frame at a time ($Z0 ${s.env.get('$Z0')})`);
  s.keyTyped(65);
  check(s.env.get('$CH') === 65, '$CH holds the last key typed');
}
// MATCH, REPLACE, LPAD: the RT/1 glossary's own examples (RT1/BASELINE/READ.ME)
{
  const s = fresh('ALPHA=[ABCDEFGHIJK\nLMNOPQRSTUVWXYZ]', 'PRINT MATCH(ALPHA,"A")', 'PRINT MATCH(ALPHA,"DEF")',
    'PRINT MATCH(ALPHA,"AZ")', 'PRINT MATCH(ALPHA,ASCII(10))', 'PRINT MATCH(ALPHA,"a")',
    'PRINT MATCH("*ABC*DEF*GHI*","*")');
  check(s.log.slice(-6).join(' ') === '0 3 -1 11 -1 0', `MATCH gives the glossary's answers (${s.log.slice(-6).join(' ')})`);
  const t = fresh('THIS="ABCDEFG ABCDEFG"', 'PRINT REPLACE(THIS,"C","--")', 'PRINT REPLACE.O(THIS,"C","--")',
    'PRINT REPLACE(THIS,"Z","--")', 'PRINT REPLACE("A$B","$","$$")');
  for (const want of ['AB--DEFG AB--DEFG', 'AB--DEFG ABCDEFG', 'ABCDEFG ABCDEFG', 'A$$B']) {
    check(t.log.includes(want), `REPLACE prints ${want}`);
  }
  const u = fresh('PRINT "<"&LPAD(42," ",5)&">"', 'PRINT "<"&LPAD.R(42,"*",5)&">"', 'PRINT "<"&LPAD.C(42,"-",5)&">"',
    'PRINT LPAD("ABCDEF","*",3)');
  for (const want of ['<   42>', '<42***>', '<-42-->', 'ABCDEF']) check(u.log.includes(want), `LPAD prints ${want}`);
}
// ++ and --, as the glossary's OPERATOR entry writes them
{
  const s = fresh('A=5', 'PRINT ++A+7', 'PRINT (++A)*2', 'PRINT --A', '++A', 'PRINT A', 'PRINT 9--A', 'PRINT 3-A');
  // 9--A is 9 minus -A: -- only counts down a name written right after it
  check(s.log.slice(-6).join(' ') === '13 14 6 7 16 -4' && s.env.get('A') === 7 && errorsIn(s.log).length === 0,
    `++ and -- change the variable and give its new value (${s.log.slice(-6).join(' ')})`);
}
// WHILE condition,{ lines }ENDWHILE
{
  // The glossary's LPAD example: 30 numbers lined up on the right
  const s = newSession();
  run(s, 'THIS=[B=0\nWHILE B<30,{\nA=INT(0%10000)\nPRINT LPAD(A," ",5)\n++B }ENDWHILE\nPRINT "DONE"]');
  s.queue.push({ text: 'THIS' });
  step(s, 30);
  const nums = s.log.filter(l => /^ *\d+$/.test(l));
  check(nums.length === 30 && nums.every(l => l.length === 5) && s.log.at(-1) === 'DONE' && s.env.get('B') === 30,
    `WHILE runs the glossary's LPAD example (${nums.length} lines)`);
  // Nested, with locals, as in the glossary's ANYPASS example
  const t = newSession();
  run(t, 'N=[DN=0;b=0\nWHILE b<3,{ a=0\nWHILE a<3,{ DN=DN+a*b;++a }ENDWHILE\n++b }ENDWHILE\nPRINT DN]');
  t.queue.push({ text: 'N' });
  step(t, 10);
  check(t.log.includes('9') && errorsIn(t.log).length === 0, 'WHILE nests, with local variables');
  // A turn per line: a loop with no end goes on over frames, ESC-able
  const u = newSession();
  run(u, 'X=0');
  run(u, 'W=[WHILE 1,{X=X+1}ENDWHILE]');
  u.queue.push({ text: 'W' });
  step(u, 10);
  const x = u.env.get('X');
  check(x > 10 && x < 1000 && u.isBusy(), `WHILE in a macro goes a turn per line (${x} turns in 10 frames)`);
  u.breakAll();
  // At the prompt, and from a script
  const v = newSession();
  v.load('I=0\nWHILE I<4,{PRINT "I"&I\n++I\n}ENDWHILE\nPRINT "AFTER"', 'w.grass');
  step(v, 20);
  check(['I0', 'I1', 'I2', 'I3'].every(w => v.log.includes(w)) && v.log.indexOf('AFTER') > v.log.indexOf('I3'),
    'WHILE typed at the prompt loops, and the next line waits for it');
  // After a ; it loops here and now
  const w = fresh('J=0;WHILE J<3,{++J}ENDWHILE;PRINT "J"&J');
  check(w.log.includes('J3'), 'WHILE after a ; loops in place');
  const y = fresh('Q=0;WHILE 1,{++Q}ENDWHILE');
  check(errorsIn(y.log).length === 1, 'a WHILE run in place that never ends stops with an error');
  // SKIP leaves the loop; a false condition skips the braces
  const z = newSession();
  run(z, 'LEAVER=[K=0\nWHILE 1,{++K;IF K==3,SKIP 1}ENDWHILE\nPRINT "K"&K\nWHILE 0,{PRINT "NEVER"}ENDWHILE]');
  z.queue.push({ text: 'LEAVER' });
  step(z, 10);
  check(z.log.includes('K3') && !z.log.includes('NEVER') && errorsIn(z.log).length === 0,
    'SKIP leaves a WHILE, and a false WHILE runs nothing');
  const e = fresh('WHILE 1,PRINT 5');
  check(errorsIn(e.log).length === 1, 'WHILE without {}ENDWHILE is an error');
}
{
  const s = fresh('$AB=1', 'P 5');
  check(errorsIn(s.log).length === 1, '$AB=1 turns abbreviations off');
  const t = fresh('$AB=1', '$AB=0', 'P 5');
  check(errorsIn(t.log).length === 0 && t.log.includes('5'), '$AB=0 turns them back on');
}

// No macro in the lessons is hidden by a command
{
  const hidden = [];
  for (const file of lessons) {
    const s = newSession();
    s.load(fs.readFileSync(path.join(lessonDir, file), 'utf8'), file);
    step(s, 2);
    for (const [name, v] of s.env.globals) {
      if (typeof v === 'string' && s.interpreter.commands.resolve(name)) hidden.push(`${file}:${name}`);
    }
  }
  check(hidden.length === 0, `no lesson macro has a command's name${hidden.length ? ': ' + hidden.join(', ') : ''}`);
}

console.log(failures ? `${failures} check(s) failed` : 'All checks passed');
process.exit(failures ? 1 : 0);
