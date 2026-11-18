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

// RT/1's operators (GLOB.C op_tab): # and <> not equal, =< and =>, && and
// ||, ! absolute value, ? value, @ indirection; and .5 with no leading 0
{
  const s = fresh('PRINT !-5', 'PRINT 3#4', 'PRINT 3#3', 'PRINT 3=<4', 'PRINT 4=>5', 'PRINT 2&&3', 'PRINT 0||0',
    'PRINT 1&&0||1', 'PRINT 1+!-2*3', 'X=5;PRINT ?X', 'A=.5;PRINT A+.25', 'PRINT 2*.5', 'A=10;IF A#10,PRINT "NO"',
    'IF A=>10&&A=<10,PRINT "YES"');
  const want = ['5', '1', '0', '1', '0', '1', '0', '1', '7', '5', '0.75', '1', 'YES'];
  const got = s.log.filter(l => !l.startsWith('> '));
  check(got.join(' ') === want.join(' ') && errorsIn(s.log).length === 0,
    `RT/1's operators give its answers (${got.join(' ')})`);
  // The glossary's INDIRECTION entry, its SAME typo mended
  const t = fresh('TOM=12', 'SAM="TOM"', 'PRINT @SAM', '@SAM=7', 'PRINT TOM', 'N="Q"', 'ARRAY @N,3', 'Q(1)=4',
    'PRINT @(N&"("&1&")")', '@(N&"(2)")=9', 'PRINT Q(2)', 'PRINT @SAM+1');
  check(t.log.filter(l => !l.startsWith('> ')).join(' ') === '12 7 4 9 8' && errorsIn(t.log).length === 0,
    `@ reads and sets the variable a string names (${t.log.filter(l => !l.startsWith('> ')).join(' ')})`);
  for (const line of ['PRINT @5', 'PRINT 1|2', 'PRINT 3^2', 'PRINT COSH(1)', 'PRINT NOSUCH(1)']) {
    const u = fresh(line);
    check(errorsIn(u.log).length === 1, `${line} is an error, not a quiet wrong answer`);
  }
  const v = fresh('PRINT UNSET', 'Z="Z"', 'PRINT Z');
  check(v.log.includes('0') && v.log.includes('Z') && errorsIn(v.log).length === 0,
    'a bare name not yet set still reads as 0');
  // NAME(i)=value needs an ARRAY NAME first, and may abbreviate it
  for (const line of ['X(1)=5', 'X=3;X(1)=5', 'PRINT (Q(0):4)']) {
    const w = fresh(line);
    check(errorsIn(w.log).length === 1 && w.env.get('X') !== 5 && w.env.get('Q') !== 4,
      `${line} is an error, not a variable set`);
  }
  const y = fresh('Y=0', 'Z(Y=1)=2');
  check(y.env.get('Y') === 0 && !y.env.globals.has('Z'), 'an element of no array is refused before anything is evaluated');
  const z = fresh('ARRAY PYR,4', 'PY(2)=7', 'ARRAY G,2,3', 'G(1,2)=9', 'PRINT PYR(2)+G(1,2)');
  check(z.log.includes('16') && errorsIn(z.log).length === 0, 'array elements are set, by an abbreviated name too');
}
// Switches: checked against what each command takes, words abbreviated as on
// the UV-1 (CL.C), letters run together as on RT/1 (MIRROR.XY)
{
  const s = fresh('PRINT.S "A","B",1', 'PRINT.N "C",2', 'PRINT "D"', 'PRINT.SN "E"', 'PRINT.N', 'PRINT "F"');
  const lines = s.terminal.lines.filter(l => !l.startsWith('> '));
  check(lines.join('|') === 'AB1|C2D|EF' && errorsIn(s.log).length === 0,
    `PRINT.S leaves out the spaces and PRINT.N the NEXTLINE too (${lines.join('|')})`);
  const t = fresh('PRINT "X"', 'CL.C');
  check(!t.terminal.lines.includes('X'), 'CL.C clears the terminal, as CLEAR.CRT');
  const u = fresh('IF.N 0,PRINT "RAN"', 'IF.N 1,PRINT "NOT"');
  check(u.log.includes('RAN') && !u.log.includes('NOT'), 'IF.N runs the line when the condition is false');
  const w = fresh('MIRROR.XY', 'MIR.X.Y', 'FILL.LC 0,0,3', 'LPAD.R(1," ",3)', 'PRINT ASCII.N("A")');
  check(errorsIn(w.log).length === 0 && w.log.includes('65'), 'switches a command takes still work');
  for (const line of ['PRINT.Q 1', 'CLEAR.Q', 'MIRROR.XZ', 'BOX.F 0,0,9,9,3', 'IF.X 1,PRINT 1', 'P.Q(1)']) {
    const x = fresh(line);
    check(errorsIn(x.log).length === 1, `${line} is an unknown switch error`);
  }
  const y = newSession();
  run(y, 'M=[INPUT.S Q;PRINT "<"&Q&">"]');
  y.queue.push({ text: 'M "A,B"' });
  step(y, 5);
  check(y.log.includes('<A,B>'), 'INPUT.S is INPUT.STR, as RT/1 spelled it');
}
// Comments after a command: ; then a period, to the end of the line (RT/1
// glossary, COMMENT). A quote or bracket in one means nothing
{
  const s = fresh('LINE 6,-70,1;.THIS LINE HAS A COMMENT FOLLOWING A COMMAND', 'PRINT 5 ;   .GET THE STRING',
    'IF 1,PRINT 6;.IF IT\'S TRUE', 'PRINT "A;.B"', 'PRINT [C;.D]');
  check(s.log.join(' ') === '5 6 A;.B C;.D' && errorsIn(s.log).length === 0 && lit(s.framebuffer) > 0,
    `;. starts a comment, but not inside a string (${s.log.join(' ')})`);
  // In a macro, a quote in the comment doesn't join its line to the next
  const t = newSession();
  run(t, "M=[PRINT 1;.IT'S A COMMENT\nPRINT 2;.SO IS \"THIS\nPRINT 3\nSKIP 2;.PAST ONE LINE\nPRINT 4\nPRINT 5]");
  t.queue.push({ text: 'M' });
  step(t, 5);
  check(t.log.join(' ') === '1 2 3 5' && errorsIn(t.log).length === 0,
    `a macro's ;. comments keep its lines apart, so SKIP counts them (${t.log.join(' ')})`);
  // In a script, a bracket in the comment doesn't swallow the lines after
  const u = newSession();
  u.load('A=1;.SEE [NOTES\nB=2;.AND {MORE\nPRINT A+B', 'c.grass');
  step(u, 5);
  check(u.log.includes('3') && errorsIn(u.log).length === 0, 'a script\'s ;. comments keep its commands apart');
}

// STOP name: stops those .B and .F macros only
{
  const s = newSession();
  run(s, 'A=0;B=0;C=0;F=0');
  run(s, 'COUNTA=[A=A+1]');
  run(s, 'COUNTB=[B=B+1]');
  run(s, 'SELF=[C=C+1;IF C>=3,STOP SELF]');
  run(s, 'FAST=[F=F+1]');
  for (const m of ['COUNTA.B', 'COUNTB.B', 'SELF.B', 'FAST.F']) run(s, m);
  step(s, 5);
  run(s, 'STOP COUNTA,FAST');
  const [a, f] = [s.env.get('A'), s.env.get('F')];
  const b = s.env.get('B');
  step(s, 10);
  check(s.env.get('A') === a && s.env.get('F') === f && s.env.get('B') > b,
    `STOP stops the .B and .F macros named and no others (A ${a}->${s.env.get('A')}, B ${b}->${s.env.get('B')})`);
  check(s.env.get('C') === 3, `a .B macro can STOP itself (C=${s.env.get('C')})`);
  run(s, 'STOP COUNTB');
  check(!s.isRunning(), 'nothing runs once every macro is STOPped');
  const t = newSession();
  run(t, 'N=0;LONGNAME=[N=N+1]');
  run(t, 'LONGNAME.B');
  step(t, 3);
  const out = run(t, 'PRINT STOP(LONGN)');
  step(t, 3);
  const n = t.env.get('N');
  step(t, 3);
  check(out.includes('1') && t.env.get('N') === n, 'STOP takes an abbreviated name and returns how many it stopped');
}

// RT/1's maths functions: LN, the arcs, POWER and ARRDIM
{
  const out = (s) => s.log.filter(l => !l.startsWith('> '));
  const s = fresh('PRINT LN(EXP(2))', 'PRINT ARCSIN(1)', 'PRINT ARCCOS(1)', 'PRINT ARCTAN(1)', 'PRINT POWER(5,3)',
    'PRINT POW(2,-1)', 'ARRAY FOO,200,10', 'PRINT ARRDIM(FOO,0),ARRDIM(FOO,1),ARRDIM(FOO,2)', 'PRINT ARRDIM(FO,0)',
    '$RD=1', 'PRINT ARCSIN(1)');
  const want = ['2', '90', '0', '45', '125', '0.5', '200 10 0', '200', '1.5708'];
  check(out(s).join(' ') === want.join(' ') && errorsIn(s.log).length === 0,
    `LN, ARCSIN, ARCCOS, ARCTAN, POWER and ARRDIM give RT/1's answers, the arcs in degrees ($RD=1 radians) (${out(s).join(' ')})`);
  for (const line of ['PRINT ARCSIN(2)', 'PRINT ARCCOS(-1.5)', 'PRINT LN(0)', 'X=5;PRINT ARRDIM(X,0)', 'PRINT ARRDIM(NOSUCH,0)']) {
    const t = fresh(line);
    check(errorsIn(t.log).length === 1, `${line} is an error`);
  }
}

// WHATSIS and WHATSIS.A, BEEP
{
  const s = fresh('A=5', 'B=.5', 'S="HI"', 'M=[PRINT "RAN"]', 'ARRAY Q,3',
    'PRINT WHATSIS(A),WHATSIS(B),WHATSIS(S),WHATSIS(M),WHATSIS(Q),WHATSIS(NOPE)', 'PRINT WHATSIS.A(Q)', 'WHATSIS M');
  const got = s.log.filter(l => !l.startsWith('> '));
  check(got.join(' ') === '4 6 8 8 16 2 6' && errorsIn(s.log).length === 0,
    `WHATSIS gives RT/1's type numbers, without running a macro (${got.join(' ')})`);
  check(errorsIn(fresh('A=5', 'PRINT WHATSIS.A(A)').log).length === 1 && errorsIn(fresh('PRINT WHATSIS(5)').log).length === 1,
    'WHATSIS.A of no array, and WHATSIS of no name, are errors');
  const t = fresh('BEEP', 'BEE;PRINT 1');
  check(t.terminal.beeps === 2 && errorsIn(t.log).length === 0, `BEEP asks the page for a tone (${t.terminal.beeps})`);
}

// INPUT.N takes a name passed to a macro as the name; INPUT.F throws away
// what was typed ahead
{
  const s = fresh('FOO=5', 'TAKEN=[INPUT.N n;PRINT n]', 'TAKEV=[INPUT n;PRINT n]');
  for (const line of ['TAKEN FOO', 'TAKEV FOO', 'TAKEN 3', 'TAKEN "X Y"']) { run(s, line); step(s, 5); }
  const got = s.log.filter(l => !l.startsWith('> '));
  check(got.join('|') === 'FOO|5|3|X Y' && errorsIn(s.log).length === 0,
    `INPUT.N gives the name passed, INPUT its value (${got.join('|')})`);
  const ahead = (flush) => {
    const t = fresh(`TWO=[INPUT A\n${flush ? 'INPUT.F\n' : ''}INPUT B]`);
    run(t, 'TWO');
    step(t, 10, '1,2');
    return [t.env.get('A'), t.env.get('B'), errorsIn(t.log).length];
  };
  check(ahead(false).join() === '1,2,0' && ahead(true).join() === '1,1,0',
    `INPUT.F throws away answers typed ahead (${ahead(false)} / ${ahead(true)})`);
  const u = newSession();
  u.keyTyped(65);
  run(u, 'INPUT.F');
  check(u.env.get('$CH') === 0, 'INPUT.F clears $CH');
}

// A line whose INPUT waits carries on from that INPUT once the answer comes,
// so what came before it on the line is done once
{
  // Run macro T, answering each INPUT in turn from `answers`
  const answered = (defn, call, answers, midway) => {
    const s = fresh(defn);
    run(s, call);
    const queue = [...answers];
    for (let i = 0; i < 30; i++) {
      if (midway && i === 1) midway(s);
      if (s.repl.isWaitingForInput()) {
        s.repl.inputBuffer = queue.shift() ?? '99';
        s.repl.handleKey('', 13, { ENTER: 13 });
      }
      fakeNow += 1000 / 60;
      s.frame();
    }
    const g = (n) => s.env.get(n);
    return { s, g, asked: answers.length - queue.length, errs: errorsIn(s.log).length };
  };
  const cases = [
    ['T=[INPUT A;INPUT B]', 'T', ['7', '8'], (g) => g('A') === 7 && g('B') === 8, 'two INPUTs on one line each take their own answer'],
    ['T=[N=N+1;INPUT A]', 'T', ['7'], (g) => g('A') === 7 && g('N') === 1, 'what comes before an INPUT on its line runs once'],
    ['T=[INPUT A;A=A*2;INPUT B;PRINT A,B]', 'T', ['7', '8'], (g, s) => s.log.includes('14 8'), 'a line carries on from its INPUT, keeping what it did'],
    ['T=[IF 1,N=N+1;IF 1,INPUT A;INPUT B]', 'T', ['7', '8'], (g) => g('A') === 7 && g('B') === 8 && g('N') === 1, 'an INPUT after IFs carries on inside them'],
    ['T=[IF.N 0,INPUT A;N=N+1;INPUT B]', 'T', ['7', '8'], (g) => g('A') === 7 && g('B') === 8 && g('N') === 1, 'and after IF.N'],
    ['T=[N=N+1;INPUT A,B]', 'T 5', ['8'], (g) => g('A') === 5 && g('B') === 8 && g('N') === 1, 'an INPUT taking a macro argument and an answer'],
    ['T=[I=0\nWHILE I<2,{N=N+1;INPUT A;B=B+A;I=I+1}ENDWHILE\nPRINT "DONE"]', 'T', ['7', '8'],
      (g) => g('N') === 2 && g('B') === 15, 'an INPUT in a WHILE\'s braces carries on in its turn'],
    ['T=[WHILE (I=I+1)<3,{INPUT A;N=N+A}ENDWHILE]', 'T', ['7', '8'], (g) => g('N') === 15 && g('I') === 3,
      'a WHILE resuming after an INPUT doesn\'t test its condition again'],
    ['T=[I=0;WHILE I<2,{N=N+1;INPUT A\nB=B+A;I=I+1}ENDWHILE;PRINT B]', 'T', ['7', '8'],
      (g) => g('N') === 2 && g('B') === 15, 'and a WHILE after a ; (run in place)'],
  ];
  for (const [defn, call, answers, good, label] of cases) {
    const { s, g, asked, errs } = answered(defn, call, answers);
    check(good(g, s) && asked === answers.length && errs === 0 && !s.repl.isWaitingForInput(),
      `${label} (${JSON.stringify(defn)}: A=${g('A')} B=${g('B')} N=${g('N')}, ${asked} answers)`);
  }
  const p = answered('T=[PROMPT "AGE?";INPUT A]', 'T', ['7']);
  check(p.s.log.filter(l => l.includes('AGE?')).length === 1 && p.g('A') === 7, 'PROMPT "AGE?";INPUT A asks once');
  const st = answered('T=[N=N+1;INPUT A;INPUT B]', 'T', ['7', '8'], (s) => { s.stop(); s.play(); });
  check(st.g('N') === 1 && st.g('A') === 7 && st.g('B') === 8, `Stop and Play while an INPUT waits carry on from it (N=${st.g('N')})`);
}

// CLEAR n, CIRCLE.F, ELLIPSE, RBOX and POLYGON
{
  // A 21 by 21 square of points about (0, 0), for POLYGON
  const sqLine = () => 'ARRAY SQ,4,2;SQ(0,0)=-10;SQ(0,1)=-10;SQ(1,0)=10;SQ(1,1)=-10;SQ(2,0)=10;SQ(2,1)=10;SQ(3,0)=-10;SQ(3,1)=10';
  const s = fresh('CLEAR 2');
  check(lit(s.framebuffer) === 320 * 201 && px(s, 0, 0) === 2 && px(s, 159, -100) === 2, 'CLEAR 2 clears the screen to color 2');
  run(s, 'CLEAR');
  check(lit(s.framebuffer) === 0, 'CLEAR still clears to 0');
  const same = (a, b) => Buffer.compare(Buffer.from(a.framebuffer.pixels), Buffer.from(b.framebuffer.pixels)) === 0;
  for (const [rx, ry] of [[20, 20], [70, 30], [3, 9]]) {
    const f = fresh(`CIRCLE.F 0,0,${rx},${ry},3`);
    const g = fresh(`CIRCLE 0,0,${rx},${ry},3`, 'FILL 0,0,3');
    check(same(f, g) && lit(f.framebuffer) > lit(fresh(`CIRCLE 0,0,${rx},${ry},3`).framebuffer),
      `CIRCLE.F ${rx},${ry} lights the outline and what FILL finds inside it (${lit(f.framebuffer)}/${lit(g.framebuffer)})`);
  }
  xorCheck('CIRCLE.F', 'CIRCLE.F 10,-5,70,30,{cm}');
  check(same(fresh('ELLIPSE 10,-5,70,30,3,0'), fresh('CIRCLE 10,-5,70,30,3')) &&
    same(fresh('ELLIPSE 10,-5,70,30,3,90'), fresh('CIRCLE 10,-5,30,70,3')) &&
    same(fresh('ELLIPSE.F 10,-5,70,30,3,180'), fresh('CIRCLE.F 10,-5,70,30,3')),
    'ELLIPSE turned 0, 90 or 180 degrees is CIRCLE\'s ellipse');
  xorCheck('ELLIPSE turned', 'ELLIPSE 0,0,70,30,{cm},30');
  xorCheck('ELLIPSE.F turned', 'ELLIPSE.F 0,0,70,30,{cm},30');
  const e = fresh('ELLIPSE 0,0,70,30,3,30');
  check(px(e, 0, 0) === 0 && lit(e.framebuffer) > 200 && lit(e.framebuffer) < 600,
    `a turned ELLIPSE is an outline (${lit(e.framebuffer)} lit)`);
  const ef = fresh('ELLIPSE.F 0,0,70,30,3,30');
  const area = Math.PI * 70 * 30;
  check(px(ef, 0, 0) === 3 && Math.abs(lit(ef.framebuffer) - area) < area * 0.05,
    `a turned ELLIPSE.F covers its area (${lit(ef.framebuffer)} for ${Math.round(area)})`);
  const ee = fresh('ELLIPSE.F 0,0,40,4,3,45');
  check(px(ee, 20, 20) === 3 && px(ee, -20, 20) === 0, 'ELLIPSE turns counterclockwise, in degrees');
  const er = fresh('$RD=1', 'ELLIPSE.F 0,0,40,4,3,-.785398');
  check(px(er, 20, -20) === 3 && px(er, 20, 20) === 0, 'ELLIPSE takes radians with $RD=1');
  // RBOX
  check(same(fresh('RBOX.F 0,0,51,31,0,3'), fresh('BOX 0,0,51,31,3')) && same(fresh('RBOX.F 20,10,9,40,0,3'), fresh('BOX 20,10,9,40,3')) &&
    same(fresh('RBOX.F -7,3,50,30,0,3'), fresh('BOX -7,3,50,30,3')) && same(fresh('RBOX.F 0,0,30,50,90,3'), fresh('BOX 0,0,50,30,3')),
    'RBOX.F at angle 0 is BOX, and at 90 the BOX turned');
  check(lit(fresh('RBOX 0,0,51,31,0,3').framebuffer) === 2 * 51 + 2 * 31 - 4, 'RBOX draws the outline');
  check(lit(fresh('RBOX 0,0,51,31,0,3,3').framebuffer) > 2 * (2 * 51 + 2 * 31 - 4), 'RBOX takes a line width');
  xorCheck('RBOX turned', 'RBOX 0,0,80,40,30,{cm}');
  xorCheck('RBOX.F turned', 'RBOX.F 0,0,80,40,30,{cm}');
  xorCheck('fat RBOX', 'RBOX 0,0,80,40,30,{cm},4');
  const rb = fresh('RBOX.F 0,0,80,6,45,3');
  check(px(rb, 20, 20) === 3 && px(rb, -20, 20) === 0, 'RBOX turns counterclockwise, in degrees');
  const pr = fresh(sqLine(), 'POLYGON.F SQ,3,0,0,4,.3,45');
  check(px(pr, 20, 20) === 3 && px(pr, -20, 20) === 0, 'POLYGON turns counterclockwise, in degrees');
  const r0 = fresh('PRINT RBOX(0,0,0,10,0,3)');
  check(r0.log.includes('-1') && lit(r0.framebuffer) === 0, 'RBOX of size 0 draws nothing and gives -1, as on RT/1');
  // POLYGON
  const sq = sqLine();
  const poly = (line) => { const p = fresh(sq, line); return { n: lit(p.framebuffer), p, errs: errorsIn(p.log).length }; };
  const outline = poly('POLYGON SQ,3,0,0');
  check(outline.n === 80 && outline.errs === 0 && px(outline.p, 0, 0) === 0, `POLYGON joins the points, the last to the first (${outline.n}/80)`);
  check(poly('POLYGON.F SQ,3,0,0').n === 441, 'POLYGON.F fills it');
  const moved = poly('POLYGON.F SQ,3,50,20');
  check(px(moved.p, 50, 20) === 3 && px(moved.p, 0, 0) === 0, 'POLYGON is drawn about its centre');
  check(poly('POLYGON.F SQ,3,0,0,2,2').n === 41 * 41, 'POLYGON takes two scales');
  check(poly('POLYGON.F SQ,3,0,0,90').n === 441 && poly('POLYGON.F SQ,3,0,0,1,1,90').n === 441, 'POLYGON takes an angle, after or without the scales');
  check(poly('POLYGON.F S1,S2,SQ,3,0,0').n === 441, 'POLYGON.F takes RT/1\'s scratch arrays and needs them not');
  xorCheck('POLYGON turned', `${sq};POLYGON SQ,{cm},0,0,3,2,30`);
  xorCheck('POLYGON.F turned', `${sq};POLYGON.F SQ,{cm},0,0,3,2,30`);
  // A bow tie crosses itself: filled, its two halves meet only at the crossing
  const bow = fresh('ARRAY BW,4,2;BW(0,0)=-20;BW(0,1)=-10;BW(1,0)=20;BW(1,1)=10;BW(2,0)=20;BW(2,1)=-10;BW(3,0)=-20;BW(3,1)=10',
    'POLYGON.F BW,3,0,0');
  check(px(bow, -15, 0) === 3 && px(bow, 15, 0) === 3 && px(bow, 0, 8) === 0, 'POLYGON.F fills a crossed polygon by the even-odd rule');
  for (const line of ['X=5;POLYGON X,3,0,0', 'ARRAY V,8;POLYGON V,3,0,0', `${sq};POLYGON SQ,3`]) {
    check(errorsIn(fresh(line).log).length === 1, `${line} is an error`);
  }
}

// PATTERN: draw in the colormodes of an array
{
  const pt = 'ARRAY PT,2,2;PT(0,0)=1;PT(1,0)=2;PT(0,1)=2;PT(1,1)=1';
  const s = fresh(pt, 'PATTERN PT', 'BOX 0,0,10,10,3');
  check([[0, 0, 1], [1, 0, 2], [0, 1, 2], [1, 1, 1], [-1, 0, 2], [2, 2, 1]].every(([x, y, v]) => px(s, x, y) === v) &&
    lit(s.framebuffer) === 100 && errorsIn(s.log).length === 0, 'PATTERN draws element (i,j) i right and j up from the origin, repeated');
  const c = fresh(pt, 'PATTERN.C 1,0', 'PATTERN PT', 'BOX 0,0,10,10,3');
  const c2 = fresh(pt, 'PATTERN PT', 'PATTERN.C 1,0', 'BOX 0,0,10,10,3');
  check(px(c, 1, 0) === 1 && px(c, 0, 0) === 2 && px(c2, 1, 0) === 1, 'PATTERN.C moves the origin, before or after PATTERN');
  const k = fresh(pt, 'PATTERN PT', 'PT(0,0)=3', 'BOX 0,0,10,10,3');
  check(px(k, 0, 0) === 1, 'PATTERN keeps a copy of the array');
  const off = fresh(pt, 'PATTERN PT', 'PATTERN', 'BOX 0,0,10,10,3');
  const killed = fresh(pt, 'PATTERN PT', 'KILL', 'BOX 0,0,10,10,3');
  check(px(off, 0, 0) === 3 && px(off, 1, 0) === 3 && px(killed, 1, 0) === 3 && killed.framebuffer.modifiers.length === 0,
    'PATTERN on its own, or KILL, stops it');
  const d = fresh('BOX 0,0,4,4,3', 'SNAP SN,0,0,4,4', 'CLEAR', pt, 'PATTERN PT', 'DISPLAY SN,40,0');
  check(px(d, 40, 0) === 3 && px(d, 41, 0) === 3, 'a snap DISPLAYed under PATTERN keeps its colors, as on RT/1');
  check(errorsIn(fresh('ARRAY V,8', 'PATTERN V').log).length === 1 && errorsIn(fresh('X=1', 'PATTERN X').log).length === 1,
    'PATTERN needs a 2D array');
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
