// Converts a LICHEN patch into a standalone script for node-gles3
// (https://github.com/worldmaking/node-gles3): no node graph and no UI, just the
// patch running fullscreen, its picture the size of its Monitor's Width and
// Height.
//
// Nothing here knows what any module does. The patch's modules are looked up by
// uid in the sources js/main.js registers, and their code goes into the output
// as it is now, with everything it imports: Module.js, the shaders, graph.js
// and pipeline.js, which load and run the patch as LICHEN does. The output runs
// them on a small p5.js 1.9 written for node-gles3 (lichenP5 below), so it
// needs node-gles3 and nothing from this repo. A file a module fetches (a LUT
// preset, a model, a font) is still read from where it is in this repo, as the
// page would fetch it, so those stay where they are.
//
// Usage: node tools/patch-to-gles3.mjs <patch.json> [out.js] [--gles3 <dir>] [--monitor <node id>]
//
//   out.js     defaults to the patch's name with .js, in the current directory
//   --gles3    node-gles3's folder, written into the output for it to find;
//              defaults to the first node-gles3 folder beside this repo or one
//              of its parents
//   --monitor  which Monitor's input to show; defaults to the first Monitor
//              with something cabled to it
//
// Examples, from the repo root:
//   node tools/patch-to-gles3.mjs workflows/rainbow.json
//   node tools/patch-to-gles3.mjs workflows/undersea.json ~/GitHub/node-gles3/undersea.js
//   node tools/patch-to-gles3.mjs my-patch.json --gles3 ~/src/node-gles3 --monitor 12
//
// Running the output:
//   node rainbow.js                      fullscreen; Escape quits
//   node rainbow.js --windowed           in a window instead
//   node rainbow.js --frames 300 --capture out.png
//                                        quits after 300 frames, saving the last as a PNG
//   node rainbow.js --hidden --fixed 30 --seed 1 --frames 300 --capture out.png
//                                        the same with no window, as fast as it
//                                        renders, and the same picture every time
//
//   --windowed       a 960x720 window instead of fullscreen
//   --hidden         no window at all (and no vsync)
//   --frames <n>     quit after n frames
//   --capture <png>  save the last frame, Monitor Width x Height
//   --dump <dir>     save every framebuffer every node holds, at the last frame
//   --fixed <fps>    the clock modules read moves exactly 1/fps a frame
//   --seed <n>       Math.random() and crypto.getRandomValues() repeat from seed n
//   --density <d>    render at this pixel density instead of the one that makes
//                    the patch's 640x480 canvas cover the Monitor's size
//
// The output finds node-gles3 in $NODE_GLES3, then beside itself (as
// node-gles3's own examples sit), then at the folder --gles3 gave. A Camera
// reads the webcam through ffmpeg, if it is installed; $LICHEN_CAMERA replaces
// ffmpeg's input arguments, e.g. "-f lavfi -i testsrc2=size=640x480:rate=30".
//
// What the runtime can't do, a module can't either, and it says so and stops,
// while the rest of the patch carries on: a Camera with no ffmpeg, the ONNX
// modules (DepthAnything, Pix2Pix, InfrDrawings), whose runtime loads with a
// <script> tag, sound, and p5 drawing past what the modules here use (text,
// strokes, lighting, WEBGL createGraphics). A patch doesn't keep files picked
// in a module's panel, so Image, VideoPlayer, QTVR, VRML and NAPLPS show what
// they do in a fresh LICHEN until one is picked: nothing, as there is no panel.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const JS = path.join(ROOT, 'js');

function fail(msg) {
  console.error(`patch-to-gles3: ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Command line

function parseArgs(argv) {
  const opts = { patch: null, out: null, gles3: null, monitor: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--gles3') opts.gles3 = argv[++i];
    else if (a === '--monitor') opts.monitor = Number(argv[++i]);
    else if (a.startsWith('--')) fail(`unknown option ${a}`);
    else rest.push(a);
  }
  if (rest.length < 1 || rest.length > 2) {
    fail('usage: node tools/patch-to-gles3.mjs <patch.json> [out.js] [--gles3 <dir>] [--monitor <node id>]');
  }
  [opts.patch, opts.out] = rest;
  opts.out ??= path.basename(opts.patch, path.extname(opts.patch)) + '.js';
  return opts;
}

// node-gles3 beside the repo or one of its parents, as ~/GitHub/node-gles3 is
// to ~/GitHub/GRASS_ETC/LICHEN
function findGles3() {
  for (let dir = ROOT; ; dir = path.dirname(dir)) {
    const candidate = path.join(path.dirname(dir), 'node-gles3');
    if (fs.existsSync(path.join(candidate, 'gles3.js'))) return candidate;
    if (path.dirname(dir) === dir) return null;
  }
}

// ---------------------------------------------------------------------------
// Module lookup: what js/main.js registers, by uid

function registeredModules() {
  const main = fs.readFileSync(path.join(JS, 'main.js'), 'utf8');
  const byUid = new Map();
  for (const [, rel] of main.matchAll(/^import\s+'(\.\/modules\/[^']+)';/gm)) {
    const file = path.join(JS, rel);
    const src = fs.readFileSync(file, 'utf8');
    const uid = src.match(/static\s+uid\s*=\s*'([0-9a-f]{8})'/)?.[1];
    const name = src.match(/registerModule\(\s*'([^']+)'/)?.[1];
    if (!uid || !name) fail(`${rel} has no static uid or registerModule() call`);
    byUid.set(uid, { name, file });
  }
  return byUid;
}

// The size of LICHEN's processing canvas, from the createGraphics() call in
// js/main.js, so the patch runs at the size it was made at
function canvasSize() {
  const main = fs.readFileSync(path.join(JS, 'main.js'), 'utf8');
  const m = main.match(/createGraphics\(\s*(\d+)\s*,\s*(\d+)\s*,\s*p\.WEBGL\s*\)/);
  if (!m) fail('js/main.js has no createGraphics(width, height, p.WEBGL) call to take the canvas size from');
  return [Number(m[1]), Number(m[2])];
}

// ---------------------------------------------------------------------------
// Bundler. Each ES module becomes a function its imports call, keyed by its
// file:// URL. A file with no import or export statement is a classic script,
// as the libraries the modules load for their globals are, and runs in the
// global scope. Dynamic import() and new Worker(new URL(...)) are followed too.

const IDENT = '[A-Za-z_$][\\w$]*';
// Where a statement starts: a line's start, or after ; or } as in minified code
const AT = '(?:^|(?<=[;}]))[ \\t]*';
const at = (re) => new RegExp(AT + re, 'gm');
// An import or export statement, not import() or import.meta
const MODULE_SYNTAX = new RegExp(AT + '(?:import\\s*[\\w{*\'"]|export\\s*(?:default\\b|[{*]|(?:async\\s+)?function\\b|class\\b|const\\b|let\\b|var\\b))', 'm');

class Bundle {
  constructor() {
    this.modules = new Map();   // url -> { code, exports: Set } for ES modules
    this.classics = new Map();  // url -> source of a classic script
    this.workers = new Set();   // file paths of worker entries
  }

  add(file) {
    const url = pathToFileURL(file).href;
    if (this.modules.has(url) || this.classics.has(url)) return url;
    if (!fs.existsSync(file)) fail(`${file} is imported but doesn't exist`);
    const src = fs.readFileSync(file, 'utf8');
    if (!MODULE_SYNTAX.test(src)) {
      this.classics.set(url, src);
      return url;
    }
    const entry = { code: null, exports: new Set(), imports: [] };
    this.modules.set(url, entry);
    entry.code = this._transform(src, file, entry);
    return url;
  }

  _resolve(spec, file) {
    if (!/^\.{1,2}\//.test(spec)) fail(`${path.relative(ROOT, file)} imports '${spec}', which isn't a relative path`);
    return path.resolve(path.dirname(file), spec);
  }

  _transform(src, file, entry) {
    const getters = [];
    const req = (spec) => JSON.stringify(this.add(this._resolve(spec, file)));
    const named = (list) => list.split(',').map(s => s.trim()).filter(Boolean).map(s => {
      const [from, to = from] = s.split(/\s+as\s+/);
      return { from, to };
    });

    let out = src.replace(at(`import\\s*(['"])([^'"]+)\\1\\s*;?`), (m, q, spec) => `__require(${req(spec)});`);

    out = out.replace(at(`import\\b\\s*([^;'"]*?)\\s*from\\s*(['"])([^'"]+)\\2\\s*;?`), (m, clause, q, spec) => {
      const u = req(spec);
      const target = this._resolve(spec, file);
      const parts = [];
      const ns = clause.match(new RegExp(`^\\*\\s+as\\s+(${IDENT})$`));
      if (ns) return `const ${ns[1]} = __require(${u});`;
      const braces = clause.match(/\{([\s\S]*)\}/);
      const def = clause.replace(/\{[\s\S]*\}/, '').replace(/,/g, '').trim();
      if (def) {
        parts.push(`const ${def} = __require(${u}).default;`);
        entry.imports.push({ target, name: 'default' });
      }
      if (braces) {
        const names = named(braces[1]);
        for (const n of names) entry.imports.push({ target, name: n.from });
        parts.push(`const { ${names.map(n => n.from === n.to ? n.from : `${n.from}: ${n.to}`).join(', ')} } = __require(${u});`);
      }
      return parts.join(' ');
    });

    out = out.replace(at(`export\\s*\\{([^}]*)\\}\\s*from\\s*(['"])([^'"]+)\\2\\s*;?`), (m, list, q, spec) => {
      const u = req(spec);
      return named(list).map(n => {
        entry.exports.add(n.to);
        return `Object.defineProperty(__exports, ${JSON.stringify(n.to)}, { enumerable: true, get: () => __require(${u})[${JSON.stringify(n.from)}] });`;
      }).join(' ');
    });
    out = out.replace(at(`export\\s*\\{([^}]*)\\}\\s*;?`), (m, list) => {
      for (const n of named(list)) {
        entry.exports.add(n.to);
        getters.push([n.to, n.from]);
      }
      return '';
    });
    out = out.replace(at(`export\\s+((?:async\\s+)?function\\*?|class|const|let|var)\\s+(${IDENT})`), (m, kind, name) => {
      entry.exports.add(name);
      getters.push([name, name]);
      return `${kind} ${name}`;
    });
    out = out.replace(at(`export\\s+default\\s+`), () => {
      entry.exports.add('default');
      return '__exports.default = ';
    });
    const stray = out.match(MODULE_SYNTAX);
    if (stray) fail(`${path.relative(ROOT, file)}: can't convert "${out.slice(stray.index, stray.index + 80).trim()}"`);

    // Workers are bundled on their own and found again by URL (see the Worker
    // shim); other new URL()s are files the module reads, and stay put
    for (const [, , rel] of out.matchAll(/new\s+Worker\(\s*new\s+URL\(\s*(['"])([^'"]+)\1\s*,\s*import\.meta\.url\s*\)/g)) {
      this.workers.add(path.resolve(path.dirname(file), rel));
    }
    // import() of a literal path, or of a template like `./dir/${name}.js`,
    // which brings in every file the template could name
    for (const [, , spec] of out.matchAll(/(?<![\w$.])import\(\s*(['"])([^'"]+)\1\s*\)/g)) this.add(this._resolve(spec, file));
    for (const [, tpl] of out.matchAll(/(?<![\w$.])import\(\s*`([^`]*)`\s*\)/g)) {
      const head = tpl.slice(0, tpl.indexOf('${'));
      const tail = tpl.slice(tpl.lastIndexOf('}') + 1);
      const dir = this._resolve(head.slice(0, head.lastIndexOf('/') + 1) || './', file);
      const prefix = head.slice(head.lastIndexOf('/') + 1);
      for (const f of fs.readdirSync(dir)) {
        if (f.startsWith(prefix) && f.endsWith(tail)) this.add(path.join(dir, f));
      }
    }
    out = out.replace(/(?<![\w$.])import\s*\(/g, '__import(');
    out = out.replace(/\bimport\.meta\b/g, '__meta');

    const head = getters.map(([as, local]) =>
      `Object.defineProperty(__exports, ${JSON.stringify(as)}, { enumerable: true, get: () => ${local} });`).join('\n');
    return `${head}\n${out}`;
  }

  // Every name imported from a module that doesn't export it, which ES modules
  // would refuse to load
  check() {
    for (const [url, entry] of this.modules) {
      for (const { target, name } of entry.imports) {
        const dep = this.modules.get(pathToFileURL(target).href);
        if (dep && !dep.exports.has(name)) {
          fail(`${path.relative(ROOT, fileURLToPath(url))} imports ${name}, which ${path.relative(ROOT, target)} doesn't export`);
        }
      }
    }
  }

  // SOURCES and CLASSICS, as code
  emit() {
    const mods = [...this.modules].map(([url, { code }]) =>
      `${JSON.stringify(url)}: function (__exports, __meta, __require, __import) {\n'use strict';\n${code}\n}`);
    const classics = [...this.classics].map(([url, src]) => `${JSON.stringify(url)}: ${JSON.stringify(src)}`);
    return `const SOURCES = {\n${mods.join(',\n')}\n};\nconst CLASSICS = {\n${classics.join(',\n')}\n};\n`;
  }
}

// ---------------------------------------------------------------------------
// The runtime. These functions go into the output as their source text, so
// none of them can use anything from this file but each other.

// The module system: the bundled modules by URL, each run once on first import
function lichenLoader(SOURCES, CLASSICS, runClassic) {
  const cache = new Map();
  const load = (url) => {
    if (cache.has(url)) return cache.get(url);
    const ns = {};
    cache.set(url, ns);
    if (url in CLASSICS) {
      runClassic(url, CLASSICS[url]);
      return ns;
    }
    const fn = SOURCES[url];
    if (!fn) throw new Error(`${url} isn't in this bundle`);
    const dynamic = (spec) => new Promise((resolve) => resolve(load(new URL(spec, url).href)));
    fn(ns, { url }, load, dynamic);
    return ns;
  };
  return load;
}

// What both the page and a worker have that Node lacks: fetch() of a file:
// URL, or of a path relative to the page, and a location to resolve it against
function lichenWebScope(baseUrl) {
  const fs = process.getBuiltinModule('node:fs');
  const { fileURLToPath } = process.getBuiltinModule('node:url');
  globalThis.location = { href: baseUrl, origin: 'null', protocol: 'file:' };
  const netFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const href = new URL(typeof input === 'string' ? input : input.url ?? String(input), baseUrl).href;
    if (!href.startsWith('file:')) return netFetch(href, init);
    try {
      return new Response(fs.readFileSync(fileURLToPath(href)), { status: 200 });
    } catch (e) {
      return new Response(null, { status: 404, statusText: e.code });
    }
  };
  globalThis.self ??= globalThis;
}

// Runs a classic script in the global scope, where its top-level declarations
// become globals, as a <script>'s do. It can't see process while it loads, as
// a browser has none: Emscripten, for one, takes it to mean Node.
function lichenRunClassic(url, src) {
  const vm = process.getBuiltinModule('node:vm');
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'process');
  delete globalThis.process;
  try {
    vm.runInThisContext(src, { filename: url });
  } finally {
    Object.defineProperty(globalThis, 'process', desc);
  }
}

// The page around the modules: a document whose elements do nothing, since
// there is no UI, and Worker over worker_threads, running the worker's own
// bundle from WORKERS
function lichenPageScope(baseUrl, WORKERS) {
  const { Worker: ThreadWorker } = process.getBuiltinModule('node:worker_threads');
  lichenWebScope(baseUrl);

  const element = (tag) => {
    const el = {
      tagName: String(tag).toUpperCase(), style: {}, dataset: {}, children: [], childNodes: [],
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      textContent: '', innerHTML: '', innerText: '', value: '', files: null, parentNode: null,
      appendChild(c) {
        this.children.push(c);
        c.parentNode = this;
        // A script a module adds to the page isn't in the bundle, so it fails
        // as one that couldn't be fetched would
        if (c.tagName === 'SCRIPT' && c.src) {
          console.error(`${c.src} is loaded with a <script> tag, which node-gles3 can't do`);
          setImmediate(() => c.onerror?.({ type: 'error', target: c }));
        }
        return c;
      },
      append(...cs) { for (const c of cs) if (typeof c === 'object') this.appendChild(c); },
      prepend() {}, insertBefore(c) { return c; },
      removeChild(c) { this.children = this.children.filter(x => x !== c); return c; },
      remove() { this.parentNode?.removeChild(this); },
      addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
      setAttribute() {}, getAttribute: () => null, removeAttribute() {}, hasAttribute: () => false,
      querySelector: () => null, querySelectorAll: () => [], contains: () => false,
      getBoundingClientRect: () => ({ x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }),
      click() {}, focus() {}, blur() {}, getContext: () => null,
    };
    return el;
  };
  globalThis.window = globalThis;
  globalThis.document = {
    body: element('body'), head: element('head'), documentElement: element('html'),
    currentScript: null, activeElement: null, readyState: 'complete', hidden: false,
    createElement: element, createElementNS: (ns, tag) => element(tag), createTextNode: (t) => ({ textContent: t }),
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
  };
  Object.assign(globalThis, {
    addEventListener() {}, removeEventListener() {}, devicePixelRatio: 1,
    innerWidth: 1920, innerHeight: 1080,
    requestAnimationFrame: (f) => setTimeout(() => f(performance.now()), 16),
    cancelAnimationFrame: (id) => clearTimeout(id),
  });

  class Worker {
    constructor(url, options = {}) {
      const href = String(url);
      const code = WORKERS[href];
      if (!code) throw new Error(`no bundled worker for ${href}`);
      this.onmessage = null;
      this.onerror = null;
      this._listeners = { message: [], error: [] };
      this._thread = new ThreadWorker(code, { eval: true, workerData: { url: href, baseUrl } });
      this._thread.unref();
      this._thread.on('message', (data) => this._emit('message', { data }));
      this._thread.on('error', (e) => this._emit('error', { message: e.message, error: e }));
    }
    _emit(type, event) {
      const handler = this['on' + type];
      if (handler) handler.call(this, event);
      for (const l of this._listeners[type]) l.call(this, event);
    }
    postMessage(data, transfer) { this._thread.postMessage(data, Array.isArray(transfer) ? transfer : transfer?.transfer); }
    addEventListener(type, l) { this._listeners[type]?.push(l); }
    removeEventListener(type, l) { if (this._listeners[type]) this._listeners[type] = this._listeners[type].filter(x => x !== l); }
    terminate() { this._thread.terminate(); }
  }
  globalThis.Worker = Worker;

  return (url, src) => {
    document.currentScript = { src: url };
    try {
      lichenRunClassic(url, src);
    } finally {
      document.currentScript = null;
    }
  };
}

// Inside a worker: self.onmessage and postMessage over the thread's port
function lichenWorkerScope() {
  const { parentPort, workerData } = process.getBuiltinModule('node:worker_threads');
  // An eval'd worker has CommonJS's globals, which send a UMD script's exports
  // to module.exports instead of self, as a Web Worker would
  for (const k of ['module', 'exports', 'require', '__filename', '__dirname']) delete globalThis[k];
  lichenWebScope(workerData.url);
  self.onmessage = null;
  const listeners = [];
  self.addEventListener = (type, l) => { if (type === 'message') listeners.push(l); };
  self.removeEventListener = () => {};
  self.postMessage = (data, transfer) => parentPort.postMessage(data, Array.isArray(transfer) ? transfer : transfer?.transfer);
  self.close = () => process.exit(0);
  self.importScripts = () => { throw new Error('importScripts() isn\'t supported in a bundled worker'); };
  parentPort.on('message', (data) => {
    const event = { data };
    if (self.onmessage) self.onmessage(event);
    for (const l of listeners) l(event);
  });
  return lichenRunClassic;
}

// The part of p5.js 1.9 the modules use, on node-gles3's GL. The graphics a
// module is given (glCanvas) is a WEBGL p5.Graphics: shaders, framebuffers,
// rect(), model(), the matrix stack and the framebuffer camera, blend modes,
// p5.Image textures and a camera capture. The behaviour copies p5 1.9.4's,
// down to what it leaves blending and samplers set to, so the patch draws as
// it does in the browser.
function lichenP5(gl, glm, opts) {
  const { mat4, mat3 } = glm;
  const { width, height, openCapture } = opts;
  let density = opts.density;

  const C = {
    BLEND: 'source-over', ADD: 'lighter', REPLACE: 'copy', MULTIPLY: 'multiply', SCREEN: 'screen',
    EXCLUSION: 'exclusion', REMOVE: 'destination-out', SUBTRACT: 'subtract', DARKEST: 'darken',
    LIGHTEST: 'lighten', DIFFERENCE: 'difference', OVERLAY: 'overlay', HARD_LIGHT: 'hard-light',
    SOFT_LIGHT: 'soft-light', DODGE: 'color-dodge', BURN: 'color-burn',
    UNSIGNED_BYTE: 'unsigned-byte', UNSIGNED_INT: 'unsigned-int', FLOAT: 'float', HALF_FLOAT: 'half-float',
    RGB: 'rgb', RGBA: 'rgba', NEAREST: 'nearest', LINEAR: 'linear', CLAMP: 'clamp', REPEAT: 'repeat', MIRROR: 'mirror',
    POINTS: 0x0000, LINES: 0x0001, LINE_STRIP: 0x0003, LINE_LOOP: 0x0002, TRIANGLES: 0x0004,
    TRIANGLE_STRIP: 0x0005, TRIANGLE_FAN: 0x0006, QUADS: 'quads', QUAD_STRIP: 'quad_strip', TESS: 'tess', CLOSE: 'close',
    NORMAL: 'normal', IMAGE: 'image', CORNER: 'corner', CORNERS: 'corners', CENTER: 'center', RADIUS: 'radius',
    VIDEO: 'video', AUDIO: 'audio', WEBGL: 'webgl', WEBGL2: 'webgl2', P2D: 'p2d',
    PI: Math.PI, TWO_PI: Math.PI * 2, HALF_PI: Math.PI / 2, QUARTER_PI: Math.PI / 4, TAU: Math.PI * 2,
  };

  // --- WebGL2 over node-gles3 ------------------------------------------------
  // node-gles3 takes typed arrays and plain ids where WebGL takes arrays and
  // objects, and has no getParameter() or WebGL-only pixel store flags. ctx is
  // gl with those filled in; modules that use the GL directly get it as
  // drawingContext, and everything here goes through it so the bindings it
  // reports stay true.
  const WEBGL_STORE = { 0x9240: 'flipY', 0x9241: 'premultiply', 0x9243: 'colorspace' };
  const st = {
    flipY: false, premultiply: false, colorspace: 0x9244, unit: 0, tex2D: [], drawFb: null, readFb: null,
    program: null, arrayBuffer: null, renderbuffer: null, vao: null, viewport: [0, 0, 0, 0],
  };
  const f32 = (v) => v instanceof Float32Array ? v : new Float32Array(v);
  const i32 = (v) => v instanceof Int32Array ? v : new Int32Array(v);
  const loc = (l) => l === null || l === undefined || l < 0;
  // node-gles3's functions are read-only, so ctx copies them rather than
  // inheriting them
  const ctx = {};
  for (const k of Object.getOwnPropertyNames(gl)) ctx[k] = gl[k];
  const uniformV = (n, conv) => function (l, data) { if (!loc(l)) gl[n](l, data.length / Number(n[7]), conv(data)); };
  // Rows top first become bottom first, as UNPACK_FLIP_Y_WEBGL asks
  const flipRows = (data, w, h, bpp) => {
    const out = new data.constructor(data.length);
    const row = w * bpp;
    for (let y = 0; y < h; y++) out.set(data.subarray(y * row, (y + 1) * row), (h - 1 - y) * row);
    return out;
  };
  const unpack = (data, w, h, format, type) => {
    if (!data || !ArrayBuffer.isView(data)) return data ?? null;
    const bpp = (format === gl.RGB ? 3 : format === gl.RED ? 1 : format === gl.RG ? 2 : 4) *
      (type === gl.FLOAT ? 4 : type === gl.HALF_FLOAT ? 2 : 1);
    let px = data;
    if (st.premultiply && type === gl.UNSIGNED_BYTE && format === gl.RGBA) {
      px = new Uint8Array(data);
      for (let i = 0; i < px.length; i += 4) {
        const a = px[i + 3] / 255;
        px[i] *= a; px[i + 1] *= a; px[i + 2] *= a;
      }
    }
    if (st.flipY) px = flipRows(new Uint8Array(px.buffer, px.byteOffset, px.byteLength), w * bpp, h, 1);
    return px;
  };
  const sourcePixels = (src) => src?.pixels ?? src?.data ?? null;
  Object.defineProperties(ctx, Object.getOwnPropertyDescriptors({
    UNPACK_FLIP_Y_WEBGL: 0x9240, UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241, CONTEXT_LOST_WEBGL: 0x9242,
    UNPACK_COLORSPACE_CONVERSION_WEBGL: 0x9243, BROWSER_DEFAULT_WEBGL: 0x9244,
    get drawingBufferWidth() { return Math.round(width * density); },
    get drawingBufferHeight() { return Math.round(height * density); },
    isContextLost: () => false,
    getContextAttributes: () => ({ alpha: true, antialias: true, depth: true, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false }),
    getSupportedExtensions: () => ['EXT_color_buffer_float', 'EXT_color_buffer_half_float', 'OES_texture_float_linear', 'OES_texture_half_float_linear', 'EXT_float_blend'],
    getExtension(name) { return ctx.getSupportedExtensions().includes(name) ? {} : null; },
    pixelStorei(p, v) {
      if (p in WEBGL_STORE) st[WEBGL_STORE[p]] = v;
      else gl.pixelStorei(p, Number(v));
    },
    activeTexture(u) { st.unit = u - gl.TEXTURE0; gl.activeTexture(u); },
    bindTexture(target, t) {
      if (target === gl.TEXTURE_2D) st.tex2D[st.unit] = t ?? null;
      gl.bindTexture(target, t ?? 0);
    },
    bindFramebuffer(target, fb) {
      if (target !== gl.READ_FRAMEBUFFER) st.drawFb = fb ?? null;
      if (target !== gl.DRAW_FRAMEBUFFER) st.readFb = fb ?? null;
      gl.bindFramebuffer(target, fb ?? 0);
    },
    bindRenderbuffer(target, rb) { st.renderbuffer = rb ?? null; gl.bindRenderbuffer(target, rb ?? 0); },
    bindBuffer(target, b) { if (target === gl.ARRAY_BUFFER) st.arrayBuffer = b ?? null; gl.bindBuffer(target, b ?? 0); },
    bindVertexArray(v) { st.vao = v ?? null; gl.bindVertexArray(v ?? 0); },
    useProgram(p) { st.program = p ?? null; gl.useProgram(p ?? 0); },
    viewport(x, y, w, h) { st.viewport = [x, y, w, h]; gl.viewport(x, y, w, h); },
    getParameter(p) {
      switch (p) {
        case gl.TEXTURE_BINDING_2D: return st.tex2D[st.unit] ?? null;
        case gl.ACTIVE_TEXTURE: return gl.TEXTURE0 + st.unit;
        case gl.FRAMEBUFFER_BINDING: return st.drawFb;
        case gl.READ_FRAMEBUFFER_BINDING: return st.readFb;
        case gl.RENDERBUFFER_BINDING: return st.renderbuffer;
        case gl.ARRAY_BUFFER_BINDING: return st.arrayBuffer;
        case gl.CURRENT_PROGRAM: return st.program;
        case gl.VERTEX_ARRAY_BINDING: return st.vao;
        case gl.VIEWPORT: return new Int32Array(st.viewport);
        case 0x9240: return st.flipY;
        case 0x9241: return st.premultiply;
        case 0x9243: return st.colorspace;
        case gl.BLEND: case gl.DEPTH_TEST: case gl.CULL_FACE: case gl.SCISSOR_TEST: case gl.STENCIL_TEST:
          return !!gl.isEnabled(p);
        case gl.VERSION: return 'WebGL 2.0 (node-gles3)';
        case gl.SHADING_LANGUAGE_VERSION: return 'WebGL GLSL ES 3.00 (node-gles3)';
        case gl.VENDOR: case gl.RENDERER: return 'node-gles3';
        default: return Number(gl.getInteger64v(p));
      }
    },
    getShaderParameter: (s, p) => p === gl.COMPILE_STATUS || p === gl.DELETE_STATUS ? !!gl.getShaderParameter(s, p) : gl.getShaderParameter(s, p),
    getProgramParameter: (pr, p) => p === gl.LINK_STATUS || p === gl.DELETE_STATUS || p === gl.VALIDATE_STATUS ? !!gl.getProgramParameter(pr, p) : gl.getProgramParameter(pr, p),
    getUniformLocation(p, name) { const l = gl.getUniformLocation(p, name); return l < 0 ? null : l; },
    getAttribLocation: (p, name) => gl.getAttribLocation(p, name),
    deleteTexture: (t) => t && gl.deleteTextures(t),
    deleteFramebuffer: (f) => f && gl.deleteFramebuffers(f),
    deleteRenderbuffer: (r) => r && gl.deleteRenderbuffers(r),
    deleteBuffer: (b) => b && gl.deleteBuffers(b),
    deleteVertexArray: (v) => v && gl.deleteVertexArrays(v),
    texImage2D(...a) {
      if (a.length === 6) {
        const [target, level, internal, format, type, src] = a;
        const w = src.width, h = src.height;
        return gl.texImage2D(target, level, internal, w, h, 0, format, type, unpack(sourcePixels(src), w, h, format, type));
      }
      const [target, level, internal, w, h, border, format, type, data, offset] = a;
      const px = offset ? data.subarray(offset) : data;
      gl.texImage2D(target, level, internal, w, h, border, format, type, unpack(px, w, h, format, type));
    },
    texSubImage2D(...a) {
      if (a.length === 7) {
        const [target, level, x, y, format, type, src] = a;
        return gl.texSubImage2D(target, level, x, y, src.width, src.height, format, type, unpack(sourcePixels(src), src.width, src.height, format, type));
      }
      const [target, level, x, y, w, h, format, type, data, offset] = a;
      const px = offset ? data.subarray(offset) : data;
      gl.texSubImage2D(target, level, x, y, w, h, format, type, unpack(px, w, h, format, type));
    },
    readPixels(x, y, w, h, format, type, dst, offset) {
      gl.readPixels(x, y, w, h, format, type, offset ? dst.subarray(offset) : dst);
    },
    uniform1f(l, x) { if (!loc(l)) gl.uniform1f(l, Number(x)); },
    uniform2f(l, x, y) { if (!loc(l)) gl.uniform2f(l, x, y); },
    uniform3f(l, x, y, z) { if (!loc(l)) gl.uniform3f(l, x, y, z); },
    uniform4f(l, x, y, z, w) { if (!loc(l)) gl.uniform4f(l, x, y, z, w); },
    uniform1i(l, x) { if (!loc(l)) gl.uniform1i(l, Number(x)); },
    uniform2i(l, x, y) { if (!loc(l)) gl.uniform2i(l, x, y); },
    uniform3i(l, x, y, z) { if (!loc(l)) gl.uniform3i(l, x, y, z); },
    uniform4i(l, x, y, z, w) { if (!loc(l)) gl.uniform4i(l, x, y, z, w); },
    uniform1fv: uniformV('uniform1fv', f32), uniform2fv: uniformV('uniform2fv', f32),
    uniform3fv: uniformV('uniform3fv', f32), uniform4fv: uniformV('uniform4fv', f32),
    uniform1iv: uniformV('uniform1iv', i32), uniform2iv: uniformV('uniform2iv', i32),
    uniform3iv: uniformV('uniform3iv', i32), uniform4iv: uniformV('uniform4iv', i32),
    uniformMatrix2fv(l, t, v) { if (!loc(l)) gl.uniformMatrix2fv(l, !!t, f32(v)); },
    uniformMatrix3fv(l, t, v) { if (!loc(l)) gl.uniformMatrix3fv(l, !!t, f32(v)); },
    uniformMatrix4fv(l, t, v) { if (!loc(l)) gl.uniformMatrix4fv(l, !!t, f32(v)); },
  }));

  // --- GLSL ES 1.00 to GLSL 3.30 core ----------------------------------------
  // The modules' shaders are WebGL1 GLSL, which desktop core profiles don't take
  // Names GLSL 3.30 reserves, as built-ins or keywords, that GLSL ES 1.00 leaves
  // free, so a shader may have used them for its own functions and variables
  const RESERVED_330 = new Set(`noise1 noise2 noise3 noise4 round roundEven trunc modf isnan isinf sinh cosh tanh
    asinh acosh atanh floatBitsToInt floatBitsToUint intBitsToFloat uintBitsToFloat outerProduct transpose
    determinant inverse texture textureProj textureLod textureOffset texelFetch texelFetchOffset textureProjOffset
    textureLodOffset textureProjLod textureProjLodOffset textureGrad textureGradOffset textureProjGrad
    textureProjGradOffset textureSize sample in out inout flat smooth noperspective centroid layout patch
    uint uvec2 uvec3 uvec4 switch case default`.split(/\s+/));
  const toCore = (src, stage) => {
    let s = String(src).replace(/^\s*#version[^\n]*\n/, '').replace(/^\s*#extension[^\n]*$/gm, '');
    const es3 = /#version\s+300\s+es/.test(String(src));
    if (!es3) {
      const own = new Set();
      for (const [, name] of s.matchAll(/\b(?:void|float|int|bool|[bi]?vec[234]|mat[234]|sampler2D|samplerCube|struct)\s+(\w+)\s*[(;=,[)]/g)) {
        if (RESERVED_330.has(name)) own.add(name);
      }
      for (const name of own) s = s.replace(new RegExp(`\\b${name}\\b`, 'g'), `lichen_${name}`);
      if (stage === 'vert') {
        s = s.replace(/\battribute\b/g, 'in').replace(/\bvarying\b/g, 'out');
      } else {
        s = s.replace(/\bvarying\b/g, 'in');
        if (/\bgl_Frag(Color|Data)\b/.test(s)) {
          s = s.replace(/\bgl_FragData\s*\[\s*0\s*\]/g, 'lichen_FragColor').replace(/\bgl_FragColor\b/g, 'lichen_FragColor');
          s = 'out vec4 lichen_FragColor;\n' + s;
        }
      }
      s = s.replace(/\btexture2D(Lod)?(EXT)?\s*\(/g, (m, lod) => lod ? 'textureLod(' : 'texture(')
        .replace(/\btextureCube(Lod)?(EXT)?\s*\(/g, (m, lod) => lod ? 'textureLod(' : 'texture(')
        .replace(/\btexture2DProj\s*\(/g, 'textureProj(');
    }
    return '#version 330\n' + s;
  };

  // uniform declarations: name -> { type, array }
  const parseUniforms = (src, into) => {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const [, type, names] of code.matchAll(/\buniform\s+(?:(?:lowp|mediump|highp)\s+)?(\w+)\s+([^;]+);/g)) {
      for (const part of names.split(',')) {
        const m = part.trim().match(/^(\w+)\s*(\[[^\]]*\])?/);
        if (m) into[m[1]] = { type, array: !!m[2] };
      }
    }
    return into;
  };
  const parseAttributes = (src) => [...String(src).matchAll(/\b(?:attribute|in)\s+(?:(?:lowp|mediump|highp)\s+)?(?:float|vec[234])\s+(\w+)\s*;/g)].map(m => m[1]);

  // --- p5.Vector, p5.Geometry, p5.Image, p5.Texture ---------------------------
  class Vector {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x, y, z) { if (x instanceof Vector) ({ x, y, z } = x); this.x = x ?? 0; this.y = y ?? 0; this.z = z ?? 0; return this; }
    copy() { return new Vector(this.x, this.y, this.z); }
    add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
    sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
    mult(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
    div(s) { this.x /= s; this.y /= s; this.z /= s; return this; }
    mag() { return Math.hypot(this.x, this.y, this.z); }
    dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
    cross(v) { return new Vector(this.y * v.z - this.z * v.y, this.z * v.x - this.x * v.z, this.x * v.y - this.y * v.x); }
    normalize() { const m = this.mag(); if (m) this.div(m); return this; }
    array() { return [this.x, this.y, this.z]; }
    static sub(a, b) { return a.copy().sub(b); }
    static add(a, b) { return a.copy().add(b); }
    static cross(a, b) { return a.cross(b); }
  }

  class Geometry {
    constructor(detailX = 1, detailY = 1, callback) {
      this.detailX = detailX; this.detailY = detailY;
      this.vertices = []; this.uvs = []; this.faces = []; this.vertexNormals = [];
      this.vertexColors = []; this.edges = []; this.lineVertices = [];
      this.gid = undefined;
      if (typeof callback === 'function') callback.call(this);
    }
    reset() { this.vertices = []; this.uvs = []; this.faces = []; this.vertexNormals = []; this.vertexColors = []; this.edges = []; return this; }
    computeFaces() {
      const slice = this.detailX + 1;
      for (let y = 0; y < this.detailY; y++) {
        for (let x = 0; x < this.detailX; x++) {
          const a = y * slice + x, b = a + 1, c = (y + 1) * slice + x + 1, d = (y + 1) * slice + x;
          this.faces.push([a, b, d], [d, b, c]);
        }
      }
      return this;
    }
    computeNormals() {
      this.vertexNormals = this.vertices.map(() => new Vector());
      for (const [a, b, c] of this.faces) {
        const va = this.vertices[a], vb = this.vertices[b], vc = this.vertices[c];
        const n = Vector.sub(vb, va).cross(Vector.sub(vc, va));
        for (const i of [a, b, c]) this.vertexNormals[i].add(n);
      }
      for (const n of this.vertexNormals) n.normalize();
      return this;
    }
    _makeTriangleEdges() { return this; }
    _edgesToVertices() { return this; }
    normalize() { return this; }
  }

  class Image {
    constructor(w, h) {
      this.width = w; this.height = h;
      this.pixels = new Uint8ClampedArray(w * h * 4);
      this._modified = true;
    }
    loadPixels() {}
    updatePixels() { this._modified = true; }
    setModified(v) { this._modified = v; }
    get(x, y, w, h) {
      if (x === undefined) return this.get(0, 0, this.width, this.height);
      if (w === undefined) {
        const i = (y * this.width + x) * 4;
        return [...this.pixels.subarray(i, i + 4)];
      }
      const out = new Image(w, h);
      for (let r = 0; r < h; r++) {
        const from = ((y + r) * this.width + x) * 4;
        out.pixels.set(this.pixels.subarray(from, from + w * 4), r * w * 4);
      }
      return out;
    }
    set(x, y, c) { const i = (y * this.width + x) * 4; this.pixels.set(Array.isArray(c) ? c : c.levels, i); }
    resize() { throw new Error('p5.Image.resize() isn\'t supported in node-gles3'); }
  }

  // A GL texture for an image or capture, uploaded again when it changes
  class Texture {
    constructor(src) {
      this.src = src;
      this.glTex = ctx.createTexture();
      this.glMinFilter = gl.LINEAR; this.glMagFilter = gl.LINEAR;
      this.glWrapS = gl.CLAMP_TO_EDGE; this.glWrapT = gl.CLAMP_TO_EDGE;
      this.width = 0; this.height = 0;
      this._apply();
    }
    _apply() {
      ctx.bindTexture(gl.TEXTURE_2D, this.glTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, this.glMinFilter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, this.glMagFilter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, this.glWrapS);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, this.glWrapT);
    }
    // p5 uploads with UNPACK_PREMULTIPLY_ALPHA_WEBGL on, rows top first
    update() {
      const src = this.src;
      const fresh = src instanceof Image ? src._modified : src._takeFrame?.();
      if (!fresh) return;
      const px = src instanceof Image ? src.pixels : fresh;
      const premul = st.premultiply;
      st.premultiply = true;
      ctx.bindTexture(gl.TEXTURE_2D, this.glTex);
      const data = new Uint8Array(px.buffer, px.byteOffset, px.byteLength);
      if (this.width !== src.width || this.height !== src.height) {
        this.width = src.width; this.height = src.height;
        ctx.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, src.width, src.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      } else {
        ctx.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, src.width, src.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
      }
      st.premultiply = premul;
      if (src instanceof Image) src._modified = false;
    }
    setInterpolation(down, up) {
      this.glMinFilter = down === C.NEAREST ? gl.NEAREST : gl.LINEAR;
      this.glMagFilter = up === C.NEAREST ? gl.NEAREST : gl.LINEAR;
      this._apply();
    }
    setWrapMode(x, y = x) {
      const wrap = (m) => m === C.REPEAT ? gl.REPEAT : m === C.MIRROR ? gl.MIRRORED_REPEAT : gl.CLAMP_TO_EDGE;
      this.glWrapS = wrap(x); this.glWrapT = wrap(y);
      this._apply();
    }
    bindTexture() { ctx.bindTexture(gl.TEXTURE_2D, this.glTex); return this; }
    unbindTexture() { ctx.bindTexture(gl.TEXTURE_2D, null); }
  }

  // createCapture(VIDEO): frames from opts.openCapture(), which calls back with
  // RGBA rows top first at the size asked
  class Capture {
    constructor(onReady) {
      this.width = 640; this.height = 480;
      this.loadedmetadata = false;
      this.elt = { readyState: 0, srcObject: null, videoWidth: 0, videoHeight: 0 };
      this._frame = null;
      this._fresh = false;
      this._onReady = onReady;
      this._stream = null;
      this._started = false;
    }
    _start() {
      if (this._started) return;
      this._started = true;
      this._stream = openCapture(this.width, this.height, (frame) => {
        this._frame = frame;
        this._fresh = true;
        if (!this.loadedmetadata) {
          this.loadedmetadata = true;
          this.elt.readyState = 4;
          this.elt.videoWidth = this.width; this.elt.videoHeight = this.height;
          this._onReady?.();
        }
      });
    }
    _takeFrame() { if (!this._fresh) return null; this._fresh = false; return this._frame; }
    size(w, h) { this.width = w; this.height = h ?? w * 0.75; this._restart(); }
    _restart() { if (this._stream) { this._stream.stop(); this._started = false; this._start(); } }
    hide() {} show() {} play() {} pause() {} loop() {} noLoop() {} volume() {}
    stop() { this._stream?.stop(); }
    remove() { this._stream?.stop(); }
    get(...a) { return null; }
  }

  // --- Shaders ---------------------------------------------------------------
  const EMPTY = Symbol('empty');
  class Shader {
    constructor(renderer, vertSrc, fragSrc) {
      this._renderer = renderer;
      this._vertSrc = vertSrc; this._fragSrc = fragSrc;
      this._glProgram = 0;
      this._failed = false;
      this.uniforms = {};
      this.samplers = [];
      this.attributes = {};
      this._values = {};
    }
    init() {
      if (this._glProgram || this._failed) return this;
      const compile = (type, src, label) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (gl.getShaderParameter(s, gl.COMPILE_STATUS)) return s;
        this._failed = true;
        console.error(`A ${label} shader didn't compile:\n${gl.getShaderInfoLog(s)}\n${src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n')}`);
        return null;
      };
      const vs = compile(gl.VERTEX_SHADER, toCore(this._vertSrc, 'vert'), 'vertex');
      const fs = compile(gl.FRAGMENT_SHADER, toCore(this._fragSrc, 'frag'), 'fragment');
      if (!vs || !fs) return this;
      const p = gl.createProgram();
      gl.attachShader(p, vs);
      gl.attachShader(p, fs);
      gl.linkProgram(p);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        this._failed = true;
        console.error(`A shader didn't link: ${gl.getProgramInfoLog(p)}`);
        return this;
      }
      this._glProgram = p;
      const decls = parseUniforms(this._fragSrc, parseUniforms(this._vertSrc, {}));
      for (const [name, d] of Object.entries(decls)) {
        const location = ctx.getUniformLocation(p, d.array ? `${name}[0]` : name) ?? ctx.getUniformLocation(p, name);
        if (location === null) continue;
        this.uniforms[name] = { name, location, type: d.type, isArray: d.array };
        if (/^(sampler|isampler|usampler)/.test(d.type)) {
          this.uniforms[name].samplerIndex = this.samplers.length;
          this.samplers.push(this.uniforms[name]);
        }
      }
      for (const name of parseAttributes(this._vertSrc)) {
        const location = gl.getAttribLocation(p, name);
        if (location >= 0) this.attributes[name] = { name, location };
      }
      return this;
    }
    // p5 sends a value when it's set; here it waits for the draw, which is the
    // same as far as the shader sees
    setUniform(name, value) { this._values[name] = value; return this; }
    isTextureShader() { return this.init().samplers.length > 0; }
    isLightShader() { return 'uUseLighting' in this.init().uniforms; }
    isNormalShader() { return false; }
    isColorShader() { return 'uMaterialColor' in this.init().uniforms || 'aVertexColor' in this.attributes; }
    isStrokeShader() { return false; }
    copyToContext() { return this; }
    _upload() {
      for (const [name, u] of Object.entries(this.uniforms)) {
        if (u.samplerIndex !== undefined || !(name in this._values)) continue;
        let v = this._values[name];
        if (typeof v === 'boolean') v = v ? 1 : 0;
        const l = u.location;
        switch (u.type) {
          case 'float': if (typeof v === 'number') ctx.uniform1f(l, v); else ctx.uniform1fv(l, v); break;
          case 'vec2': ctx.uniform2fv(l, v); break;
          case 'vec3': ctx.uniform3fv(l, v); break;
          case 'vec4': ctx.uniform4fv(l, v); break;
          case 'int': case 'bool': if (typeof v === 'number') ctx.uniform1i(l, v); else ctx.uniform1iv(l, v.map(Number)); break;
          case 'ivec2': case 'bvec2': ctx.uniform2iv(l, v); break;
          case 'ivec3': case 'bvec3': ctx.uniform3iv(l, v); break;
          case 'ivec4': case 'bvec4': ctx.uniform4iv(l, v); break;
          case 'mat2': ctx.uniformMatrix2fv(l, false, v); break;
          case 'mat3': ctx.uniformMatrix3fv(l, false, v); break;
          case 'mat4': ctx.uniformMatrix4fv(l, false, v); break;
          case 'uint': gl.uniform1ui(l, v); break;
        }
      }
      for (const s of this.samplers) {
        const tex = this._renderer._glTextureOf(this._values[s.name]);
        ctx.activeTexture(gl.TEXTURE0 + s.samplerIndex);
        ctx.bindTexture(gl.TEXTURE_2D, tex);
        ctx.uniform1i(s.location, s.samplerIndex);
      }
      ctx.activeTexture(gl.TEXTURE0);
    }
    // After every draw p5 points each sampler at its empty texture (see Set
    // samplers again before every draw in ARCHITECTURE.md)
    _unbindTextures() { for (const s of this.samplers) this._values[s.name] = EMPTY; }
  }

  // --- Framebuffers and the framebuffer camera -------------------------------
  class Camera {
    constructor(renderer, fbo = null) {
      this._renderer = renderer;
      this.fbo = fbo;
      // p5 flips y for a framebuffer, so its row 0 is the top of the picture
      this.yScale = fbo ? -1 : 1;
      this.projMatrix = new Float32Array(16);
      this.cameraMatrix = new Float32Array(16);
      this._setDefault();
    }
    _size() { return this.fbo ? [this.fbo.width, this.fbo.height] : [width, height]; }
    _setDefault() {
      const [w, h] = this._size();
      this.eyeZ = 800;
      this.perspective(2 * Math.atan(h / 2 / this.eyeZ), w / h, this.eyeZ * 0.1, this.eyeZ * 10);
      this.camera(0, 0, this.eyeZ, 0, 0, 0, 0, 1, 0);
    }
    perspective(fovy, aspect, near, far) {
      const [w, h] = this._size();
      fovy ??= 2 * Math.atan(h / 2 / 800); aspect ??= w / h; near ??= 80; far ??= 8000;
      const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
      this.projMatrix.set([f / aspect, 0, 0, 0, 0, -f * this.yScale, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
      if (this._renderer._curCamera === this) this._renderer.uPMatrix.mat4.set(this.projMatrix);
    }
    ortho(l, r, b, t, near = 0, far) {
      const [w, h] = this._size();
      l ??= -w / 2; r ??= w / 2; b ??= -h / 2; t ??= h / 2; far ??= Math.max(w, h) + 800;
      const x = 2 / (r - l), y = 2 / (t - b) * this.yScale, z = -2 / (far - near);
      this.projMatrix.set([x, 0, 0, 0, 0, -y, 0, 0, 0, 0, z, 0, -(r + l) / (r - l), -(t + b) / (t - b), -(far + near) / (far - near), 1]);
      if (this._renderer._curCamera === this) this._renderer.uPMatrix.mat4.set(this.projMatrix);
    }
    camera(ex, ey, ez, cx = 0, cy = 0, cz = 0, ux = 0, uy = 1, uz = 0) {
      if (ex === undefined) { ex = 0; ey = 0; ez = this.eyeZ; }
      mat4.lookAt(this.cameraMatrix, [ex, ey, ez], [cx, cy, cz], [ux, uy, uz]);
      if (this._renderer._curCamera === this) this._renderer.uMVMatrix.mat4.set(this.cameraMatrix);
    }
  }

  class FramebufferTexture {
    constructor(fbo, property) { this.framebuffer = fbo; this.property = property; }
    rawTexture() { return this.framebuffer[this.property]; }
    get width() { return this.framebuffer.width * this.framebuffer.density; }
    get height() { return this.framebuffer.height * this.framebuffer.density; }
  }

  class Framebuffer {
    constructor(target, o = {}) {
      this.target = target;
      this.gl = ctx;
      this.format = o.format || C.UNSIGNED_BYTE;
      this.channels = o.channels || C.RGBA;
      this.useDepth = o.depth === undefined ? true : o.depth;
      this.depthFormat = o.depthFormat || C.FLOAT;
      this.textureFiltering = o.textureFiltering || C.LINEAR;
      this.antialiasSamples = o.antialias === undefined ? 2 : typeof o.antialias === 'number' ? o.antialias : o.antialias ? 2 : 0;
      this.antialias = this.antialiasSamples > 0;
      this.density = o.density || target.pixelDensity();
      this._autoSized = !(o.width && o.height);
      this.width = o.width && o.height ? o.width : target.width;
      this.height = o.width && o.height ? o.height : target.height;
      this.pixels = [];
      this.color = new FramebufferTexture(this, 'colorTexture');
      this.depth = this.useDepth ? new FramebufferTexture(this, 'depthTexture') : undefined;
      this.defaultCamera = new Camera(target, this);
      this._create();
      target.framebuffers.add(this);
    }
    get _pw() { return Math.trunc(this.width * this.density); }
    get _ph() { return Math.trunc(this.height * this.density); }
    _colorFormat() {
      const rgb = this.channels === C.RGB;
      if (this.format === C.FLOAT) return { internal: rgb ? gl.RGB32F : gl.RGBA32F, format: rgb ? gl.RGB : gl.RGBA, type: gl.FLOAT };
      if (this.format === C.HALF_FLOAT) return { internal: rgb ? gl.RGB16F : gl.RGBA16F, format: rgb ? gl.RGB : gl.RGBA, type: gl.HALF_FLOAT };
      return { internal: rgb ? gl.RGB8 : gl.RGBA8, format: rgb ? gl.RGB : gl.RGBA, type: gl.UNSIGNED_BYTE };
    }
    _create() {
      const w = this._pw, h = this._ph;
      const prevFb = st.drawFb, prevTex = st.tex2D[st.unit];
      const cf = this._colorFormat();
      const filter = this.textureFiltering === C.NEAREST ? gl.NEAREST : gl.LINEAR;
      const texture = (internal, format, type, f) => {
        const t = ctx.createTexture();
        ctx.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
        return t;
      };
      this.colorTexture = texture(cf.internal, cf.format, cf.type, filter);
      this.framebuffer = ctx.createFramebuffer();
      ctx.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.colorTexture, 0);
      if (this.useDepth) {
        const fmt = this.depthFormat === C.FLOAT ? [gl.DEPTH_COMPONENT32F, gl.FLOAT] : [gl.DEPTH_COMPONENT24, gl.UNSIGNED_INT];
        this.depthTexture = texture(fmt[0], gl.DEPTH_COMPONENT, fmt[1], gl.NEAREST);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depthTexture, 0);
      }
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(`a ${w}x${h} ${this.format} framebuffer is incomplete`);
      }
      if (this.antialias) {
        this.aaFramebuffer = ctx.createFramebuffer();
        ctx.bindFramebuffer(gl.FRAMEBUFFER, this.aaFramebuffer);
        this.colorRenderbuffer = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, this.colorRenderbuffer);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.antialiasSamples, cf.internal, w, h);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.colorRenderbuffer);
        if (this.useDepth) {
          this.depthRenderbuffer = gl.createRenderbuffer();
          gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthRenderbuffer);
          gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.antialiasSamples,
            this.depthFormat === C.FLOAT ? gl.DEPTH_COMPONENT32F : gl.DEPTH_COMPONENT24, w, h);
          gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthRenderbuffer);
        }
        gl.bindRenderbuffer(gl.RENDERBUFFER, 0);
      }
      // WebGL starts every texture blank
      for (const fb of [this.framebuffer, this.aaFramebuffer]) {
        if (!fb) continue;
        ctx.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.viewport(0, 0, w, h);
        gl.clearColor(0, 0, 0, 0);
        gl.clearDepthf(1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      }
      gl.viewport(...st.viewport);
      ctx.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
      ctx.bindTexture(gl.TEXTURE_2D, prevTex);
    }
    _delete() {
      ctx.deleteTexture(this.colorTexture);
      ctx.deleteTexture(this.depthTexture);
      ctx.deleteFramebuffer(this.framebuffer);
      ctx.deleteFramebuffer(this.aaFramebuffer);
      ctx.deleteRenderbuffer(this.colorRenderbuffer);
      ctx.deleteRenderbuffer(this.depthRenderbuffer);
      this.depthTexture = this.aaFramebuffer = this.colorRenderbuffer = this.depthRenderbuffer = undefined;
    }
    resize(w, h) {
      this._autoSized = false;
      this.width = w; this.height = h;
      this._delete();
      this._create();
      this.defaultCamera._setDefault();
    }
    pixelDensity(d) {
      if (d === undefined) return this.density;
      this.density = d;
      this._delete();
      this._create();
    }
    autoSized(v) { if (v === undefined) return this._autoSized; this._autoSized = v; }
    remove() {
      this._delete();
      this.target.framebuffers.delete(this);
    }
    _framebufferToBind() { return this.antialias ? this.aaFramebuffer : this.framebuffer; }
    _beforeBegin() {
      ctx.bindFramebuffer(gl.FRAMEBUFFER, this._framebufferToBind());
      ctx.viewport(0, 0, this._pw, this._ph);
    }
    _beforeEnd() {
      if (!this.antialias) return;
      ctx.bindFramebuffer(gl.READ_FRAMEBUFFER, this.aaFramebuffer);
      ctx.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.framebuffer);
      const w = this._pw, h = this._ph;
      gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, this.textureFiltering === C.NEAREST ? gl.NEAREST : gl.LINEAR);
      if (this.useDepth) gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    }
    begin() {
      const r = this.target;
      this.prevFramebuffer = r.activeFramebuffer();
      this.prevFramebuffer?._beforeEnd();
      r.activeFramebuffers.push(this);
      this._beforeBegin();
      r.push();
      r.setCamera(this.defaultCamera);
      r.uMVMatrix.mat4.set(this.defaultCamera.cameraMatrix);
    }
    end() {
      const r = this.target;
      r.pop();
      if (r.activeFramebuffers.pop() !== this) throw new Error('end() called on a framebuffer that isn\'t the active one');
      this._beforeEnd();
      if (this.prevFramebuffer) this.prevFramebuffer._beforeBegin();
      else r._bindCanvas();
    }
    draw(f) { this.begin(); try { f(); } finally { this.end(); } }
    // Rows come back as GL stores them: row 0 is the top of the picture
    loadPixels() {
      const w = this._pw, h = this._ph;
      const prev = st.drawFb;
      const cf = this._colorFormat();
      const n = w * h * 4;
      if (this.pixels?.length !== n || !(this.pixels instanceof (cf.type === gl.UNSIGNED_BYTE ? Uint8Array : Float32Array))) {
        this.pixels = cf.type === gl.UNSIGNED_BYTE ? new Uint8Array(n) : new Float32Array(n);
      }
      ctx.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
      gl.readPixels(0, 0, w, h, gl.RGBA, cf.type === gl.UNSIGNED_BYTE ? gl.UNSIGNED_BYTE : gl.FLOAT, this.pixels);
      ctx.bindFramebuffer(gl.FRAMEBUFFER, prev);
    }
    get(x, y, w, h) {
      this.loadPixels();
      const pw = this._pw, ph = this._ph;
      if (x === undefined) { x = 0; y = 0; w = this.width; h = this.height; }
      if (w === undefined) {
        const i = ((Math.trunc(y * this.density)) * pw + Math.trunc(x * this.density)) * 4;
        return [...this.pixels.subarray(i, i + 4)];
      }
      const d = this.density, img = new Image(Math.trunc(w * d), Math.trunc(h * d));
      for (let r = 0; r < img.height; r++) {
        const from = ((Math.trunc(y * d) + r) * pw + Math.trunc(x * d)) * 4;
        img.pixels.set(this.pixels.subarray(from, from + img.width * 4), r * img.width * 4);
      }
      return img;
    }
    createCamera() { return new Camera(this.target, this); }
  }

  // --- The graphics: glCanvas -------------------------------------------------
  const color = (args) => {
    let a = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    if (a[0] && typeof a[0] === 'object' && a[0].levels) return a[0];
    if (typeof a[0] === 'string') {
      const hex = a[0].replace('#', '');
      const full = hex.length <= 4 ? [...hex].map(c => c + c).join('') : hex;
      const v = full.match(/../g).map(h => parseInt(h, 16));
      a = v.length === 3 ? [...v, 255] : v;
    }
    const levels = a.length === 1 ? [a[0], a[0], a[0], 255] : a.length === 2 ? [a[0], a[0], a[0], a[1]] : [a[0], a[1], a[2], a[3] ?? 255];
    return { levels, _array: levels.map(v => v / 255), toString: () => `rgba(${levels.join(',')})` };
  };

  // p5's default fill and texture shader, unlit, premultiplied as p5's are
  const defaultVert = `
attribute vec3 aPosition; attribute vec2 aTexCoord; attribute vec4 aVertexColor;
uniform mat4 uModelViewMatrix; uniform mat4 uProjectionMatrix;
uniform bool uUseVertexColor; uniform vec4 uMaterialColor;
varying vec2 vTexCoord; varying vec4 vColor;
void main() {
  gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(aPosition, 1.0);
  vTexCoord = aTexCoord;
  vColor = uUseVertexColor ? aVertexColor : uMaterialColor;
}`;
  const defaultFrag = `
precision highp float;
uniform sampler2D uSampler; uniform bool isTexture; uniform vec4 uTint;
varying vec2 vTexCoord; varying vec4 vColor;
void main() {
  gl_FragColor = isTexture ? texture2D(uSampler, vTexCoord) * (uTint / 255.0) : vec4(vColor.rgb, 1.0) * vColor.a;
}`;

  class Graphics {
    constructor() {
      Object.assign(this, C);
      this.width = width; this.height = height;
      this._renderer = this;
      this.GL = ctx;
      this.drawingContext = ctx;
      this.webglVersion = C.WEBGL2;
      this.isP3D = true;
      this.textures = new Map();
      this.framebuffers = new Set();
      this.activeFramebuffers = [];
      this.uMVMatrix = { mat4: new Float32Array(16) };
      this.uPMatrix = { mat4: new Float32Array(16) };
      this.textureMode = C.IMAGE;
      this.curBlendMode = C.BLEND;
      this.curFillColor = [1, 1, 1, 1];
      this.curStrokeColor = [0, 0, 0, 1];
      this._doFill = true; this._doStroke = true;
      this._tex = null;
      this._tint = [255, 255, 255, 255];
      this.userFillShader = undefined;
      this._stack = [];
      this._geometries = new Map();
      this._isBlending = undefined;
      this._cachedBlendMode = undefined;
      this._vao = ctx.createVertexArray();
      this._emptyTexture = null;
      this._defaultCamera = new Camera(this);
      this._curCamera = this._defaultCamera;
      this.uPMatrix.mat4.set(this._defaultCamera.projMatrix);
      this.uMVMatrix.mat4.set(this._defaultCamera.cameraMatrix);
      this._canvas = null;
      this._defaultShader = null;
      this._shape = null;
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.enable(gl.PROGRAM_POINT_SIZE);
      st.premultiply = true;
    }

    pixelDensity(d) {
      if (d === undefined) return density;
      density = d;
    }

    // The canvas itself, for drawing outside any framebuffer
    _bindCanvas() {
      if (!this._canvas) this._canvas = new Framebuffer(this, { antialias: false });
      ctx.bindFramebuffer(gl.FRAMEBUFFER, this._canvas.framebuffer);
      ctx.viewport(0, 0, this._canvas._pw, this._canvas._ph);
    }
    activeFramebuffer() { return this.activeFramebuffers[this.activeFramebuffers.length - 1]; }
    // A module that threw between begin() and end() leaves its framebuffer on
    // the stack; this takes everything off for the next one
    _resetTargets() {
      while (this.activeFramebuffers.length) {
        const fbo = this.activeFramebuffers.pop();
        fbo._beforeEnd();
      }
      this._stack.length = 0;
      this.resetShader();
      this.curBlendMode = C.BLEND;
      this._bindCanvas();
    }
    // Something drew behind p5's back (the display), so nothing cached holds
    _forgetGLState() { this._isBlending = undefined; this._cachedBlendMode = undefined; }

    createShader(vert, frag) { return new Shader(this, vert, frag); }
    createFilterShader() { throw new Error('createFilterShader() isn\'t supported in node-gles3'); }
    createFramebuffer(o) { return new Framebuffer(this, o); }
    shader(s) { s.init(); this.userFillShader = s; }
    resetShader() { this.userFillShader = undefined; }
    setCamera(cam) {
      this._curCamera = cam;
      this.uPMatrix.mat4.set(cam.projMatrix);
    }
    createCamera() { const c = new Camera(this); this.setCamera(c); return c; }
    camera(...a) { this._curCamera.camera(...a); }
    perspective(...a) { this._curCamera.perspective(...a); }
    ortho(...a) { this._curCamera.ortho(...a); }
    color(...a) { return color(a); }

    push() {
      this._stack.push({
        mv: this.uMVMatrix.mat4.slice(), p: this.uPMatrix.mat4.slice(), camera: this._curCamera,
        blend: this.curBlendMode, shader: this.userFillShader, fill: this.curFillColor, stroke: this.curStrokeColor,
        doFill: this._doFill, doStroke: this._doStroke, tex: this._tex, textureMode: this.textureMode, tint: this._tint,
      });
    }
    pop() {
      const s = this._stack.pop();
      if (!s) return;
      this.uMVMatrix.mat4.set(s.mv); this.uPMatrix.mat4.set(s.p); this._curCamera = s.camera;
      this.curBlendMode = s.blend; this.userFillShader = s.shader; this.curFillColor = s.fill; this.curStrokeColor = s.stroke;
      this._doFill = s.doFill; this._doStroke = s.doStroke; this._tex = s.tex; this.textureMode = s.textureMode; this._tint = s.tint;
    }
    translate(x, y = 0, z = 0) { if (typeof x === 'object') ({ x, y, z } = x); mat4.translate(this.uMVMatrix.mat4, this.uMVMatrix.mat4, [x, y, z]); }
    scale(x, y, z) {
      if (typeof x === 'object') ({ x, y, z } = x);
      y ??= x; z ??= x;
      mat4.scale(this.uMVMatrix.mat4, this.uMVMatrix.mat4, [x, y, z]);
    }
    rotate(a, axis = [0, 0, 1]) { mat4.rotate(this.uMVMatrix.mat4, this.uMVMatrix.mat4, a, Array.isArray(axis) ? axis : [axis.x, axis.y, axis.z]); }
    rotateX(a) { mat4.rotateX(this.uMVMatrix.mat4, this.uMVMatrix.mat4, a); }
    rotateY(a) { mat4.rotateY(this.uMVMatrix.mat4, this.uMVMatrix.mat4, a); }
    rotateZ(a) { mat4.rotateZ(this.uMVMatrix.mat4, this.uMVMatrix.mat4, a); }
    applyMatrix(...m) {
      const full = m.length === 16 ? m : [m[0], m[1], 0, 0, m[2], m[3], 0, 0, 0, 0, 1, 0, m[4], m[5], 0, 1];
      mat4.multiply(this.uMVMatrix.mat4, this.uMVMatrix.mat4, full);
    }
    resetMatrix() { this.uMVMatrix.mat4.set(this._curCamera.cameraMatrix); }

    blendMode(mode) { this.curBlendMode = mode; }
    fill(...a) { this.curFillColor = color(a)._array; this._doFill = true; this._tex = null; }
    noFill() { this._doFill = false; }
    stroke(...a) { this.curStrokeColor = color(a)._array; this._doStroke = true; }
    noStroke() { this._doStroke = false; }
    strokeWeight() {} strokeCap() {} strokeJoin() {} smooth() {} noSmooth() {}
    rectMode() {} ellipseMode() {} imageMode() {} colorMode() {}
    noLights() {} lights() {} ambientLight() {} directionalLight() {} pointLight() {}
    tint(...a) { this._tint = color(a).levels; }
    noTint() { this._tint = [255, 255, 255, 255]; }
    texture(img) { this._tex = img; }
    textureMode(m) { this.textureMode = m; }
    textureWrap() {}

    clear(r = 0, g = 0, b = 0, a = 0) {
      const fbo = this.activeFramebuffer();
      if (fbo && fbo.format === C.UNSIGNED_BYTE && !fbo.antialias && a === 0) a = 1e-10;
      gl.clearColor(r * a, g * a, b * a, a);
      gl.clearDepthf(1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    }
    background(...a) {
      const [r, g, b, al] = color(a)._array;
      this.clear(r, g, b, al);
    }

    _emptyTex() {
      if (!this._emptyTexture) this._emptyTexture = new Texture(new Image(1, 1));
      this._emptyTexture.update();
      return this._emptyTexture.glTex;
    }
    // What a sampler uniform's value draws from
    _glTextureOf(v) {
      if (v === undefined || v === null || v === EMPTY) return this._emptyTex();
      if (v instanceof Framebuffer) return v.colorTexture;
      if (v instanceof Graphics2D) return v._fbo.colorTexture;
      if (v instanceof FramebufferTexture) return v.rawTexture();
      if (v instanceof Texture) { v.update(); return v.glTex; }
      if (v === this) { if (!this._canvas) this._bindCanvas(); return this._canvas.colorTexture; }
      if (v instanceof Image || v instanceof Capture) {
        if (v instanceof Capture && !v.loadedmetadata) return this._emptyTex();
        let t = this.textures.get(v);
        if (!t) { t = new Texture(v); this.textures.set(v, t); }
        t.update();
        return t.glTex;
      }
      if (typeof v === 'number') return v;
      if (!this._warnedTexture) console.warn('A shader was given a texture of a kind node-gles3 can\'t draw; it samples blank');
      this._warnedTexture = true;
      return this._emptyTex();
    }

    _geometryBuffers(geom) {
      let b = this._geometries.get(geom.gid);
      if (b) return b;
      const flat = (list, n) => {
        const out = new Float32Array(list.length * n);
        list.forEach((v, i) => {
          if (Array.isArray(v)) out.set(v.slice(0, n), i * n);
          else out.set(n === 2 ? [v.x, v.y] : [v.x, v.y, v.z], i * n);
        });
        return out;
      };
      const uvs = geom.uvs.flat();
      const n = geom.vertices.length;
      const faces = geom.faces.flat();
      b = {
        position: flat(geom.vertices, 3),
        aTexCoord: uvs.length >= n * 2 ? new Float32Array(uvs) : null,
        aNormal: geom.vertexNormals.length === n ? flat(geom.vertexNormals, 3) : null,
        aVertexColor: geom.vertexColors.length >= n * 4 ? new Float32Array(geom.vertexColors.flat()) : null,
        index: n > 65535 ? new Uint32Array(faces) : new Uint16Array(faces),
        count: faces.length,
        vertexColors: geom.vertexColors.length >= n * 4,
        gl: {},
      };
      for (const [name, data] of [['aPosition', b.position], ['aTexCoord', b.aTexCoord], ['aNormal', b.aNormal], ['aVertexColor', b.aVertexColor]]) {
        if (!data) continue;
        const buf = ctx.createBuffer();
        ctx.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        b.gl[name] = { buf, size: name === 'aTexCoord' ? 2 : name === 'aVertexColor' ? 4 : 3 };
      }
      b.indexBuf = ctx.createBuffer();
      ctx.bindVertexArray(this._vao);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.indexBuf);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, b.index, gl.STATIC_DRAW);
      this._geometries.set(geom.gid, b);
      return b;
    }
    freeGeometry(geom) {
      const b = this._geometries.get(geom.gid);
      if (!b) return;
      for (const { buf } of Object.values(b.gl)) ctx.deleteBuffer(buf);
      ctx.deleteBuffer(b.indexBuf);
      this._geometries.delete(geom.gid);
    }

    _fillShader() {
      if (this.userFillShader && !this.userFillShader._failed) return this.userFillShader;
      if (this.userFillShader) return null;
      if (!this._defaultShader) this._defaultShader = new Shader(this, defaultVert, defaultFrag);
      return this._defaultShader.init();
    }

    // p5's _setFillUniforms and _setMatrixUniforms, then blending as
    // _applyColorBlend leaves it, then the draw
    _draw(buffers, draw, useVertexColor) {
      if (!this._doFill) return;
      const s = this._fillShader();
      if (!s || s._failed) return;
      const u = s.uniforms;
      const mv = this.uMVMatrix.mat4, p = this.uPMatrix.mat4;
      const set = (name, v) => { if (u[name]) s._values[name] = v; };
      set('uViewMatrix', this._curCamera.cameraMatrix);
      set('uProjectionMatrix', p);
      set('uModelViewMatrix', mv);
      if (u.uModelViewProjectionMatrix) set('uModelViewProjectionMatrix', mat4.multiply(new Float32Array(16), p, mv));
      if (u.uNormalMatrix) set('uNormalMatrix', mat3.normalFromMat4(new Float32Array(9), mv));
      set('uUseVertexColor', !!useVertexColor);
      set('uMaterialColor', this.curFillColor);
      set('isTexture', !!this._tex);
      if (this._tex) set('uSampler', this._tex);
      set('uTint', this._tint);
      set('uUseLighting', false);
      for (const n of ['uAmbientLightCount', 'uDirectionalLightCount', 'uPointLightCount', 'uSpotLightCount']) set(n, 0);
      set('uViewport', st.viewport);

      ctx.useProgram(s._glProgram);
      s._upload();
      ctx.bindVertexArray(this._vao);
      for (const [name, a] of Object.entries(s.attributes)) {
        const src = buffers[name];
        if (src) {
          ctx.bindBuffer(gl.ARRAY_BUFFER, src.buf);
          gl.enableVertexAttribArray(a.location);
          gl.vertexAttribPointer(a.location, src.size, gl.FLOAT, false, 0, 0);
        } else {
          gl.disableVertexAttribArray(a.location);
        }
      }

      const blending = !!this.userFillShader || this.curBlendMode !== C.BLEND || this.curFillColor[3] < 1;
      if (blending !== this._isBlending) {
        if (blending || (this.curBlendMode !== C.BLEND && this.curBlendMode !== C.ADD)) gl.enable(gl.BLEND);
        else gl.disable(gl.BLEND);
        gl.depthMask(true);
        this._isBlending = blending;
      }
      if (this._cachedBlendMode !== this.curBlendMode) {
        this._applyBlendMode();
        this._cachedBlendMode = this.curBlendMode;
      }
      draw();
      s._unbindTextures();
    }
    _applyBlendMode() {
      const g = gl;
      switch (this.curBlendMode) {
        case C.ADD: g.blendEquation(g.FUNC_ADD); g.blendFunc(g.ONE, g.ONE); break;
        case C.REMOVE: g.blendEquation(g.FUNC_ADD); g.blendFunc(g.ZERO, g.ONE_MINUS_SRC_ALPHA); break;
        case C.MULTIPLY: g.blendEquation(g.FUNC_ADD); g.blendFunc(g.DST_COLOR, g.ONE_MINUS_SRC_ALPHA); break;
        case C.SCREEN: g.blendEquation(g.FUNC_ADD); g.blendFunc(g.ONE, g.ONE_MINUS_SRC_COLOR); break;
        case C.EXCLUSION: g.blendEquationSeparate(g.FUNC_ADD, g.FUNC_ADD); g.blendFuncSeparate(g.ONE_MINUS_DST_COLOR, g.ONE_MINUS_SRC_COLOR, g.ONE, g.ONE); break;
        case C.REPLACE: g.blendEquation(g.FUNC_ADD); g.blendFunc(g.ONE, g.ZERO); break;
        case C.SUBTRACT: g.blendEquationSeparate(g.FUNC_REVERSE_SUBTRACT, g.FUNC_ADD); g.blendFuncSeparate(g.ONE, g.ONE, g.ONE, g.ONE_MINUS_SRC_ALPHA); break;
        case C.DARKEST: g.blendEquationSeparate(g.MIN, g.FUNC_ADD); g.blendFuncSeparate(g.ONE, g.ONE, g.ONE, g.ONE); break;
        case C.LIGHTEST: g.blendEquationSeparate(g.MAX, g.FUNC_ADD); g.blendFuncSeparate(g.ONE, g.ONE, g.ONE, g.ONE); break;
        default: g.blendEquation(g.FUNC_ADD); g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);
      }
    }

    model(geom) {
      if (!geom.vertices.length) return;
      const b = this._geometryBuffers(geom);
      this._draw(b.gl, () => {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.indexBuf);
        gl.drawElements(gl.TRIANGLES, b.count, b.index instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
      }, b.vertexColors);
    }

    rect(x, y, w, h) {
      h ??= w;
      if (!this._rect) {
        const g = new Geometry(1, 1, function () {
          for (let j = 0; j <= 1; j++) for (let i = 0; i <= 1; i++) { this.vertices.push(new Vector(i, j, 0)); this.uvs.push(i, j); }
        });
        g.computeFaces().computeNormals();
        g.gid = 'rect|1|1';
        this._rect = g;
      }
      const saved = this.uMVMatrix.mat4.slice();
      try {
        mat4.translate(this.uMVMatrix.mat4, this.uMVMatrix.mat4, [x, y, 0]);
        mat4.scale(this.uMVMatrix.mat4, this.uMVMatrix.mat4, [w, h, 1]);
        this.model(this._rect);
      } finally {
        this.uMVMatrix.mat4.set(saved);
      }
    }
    square(x, y, s) { this.rect(x, y, s, s); }
    plane(w = 50, h = w) {
      this.push();
      this.translate(-w / 2, -h / 2);
      this.rect(0, 0, w, h);
      this.pop();
    }
    image(img, x = 0, y = 0, w, h) {
      w ??= img.width; h ??= img.height;
      this.push();
      this.noStroke();
      this._tex = img;
      this._doFill = true;
      this.rect(x, y, w, h);
      this.pop();
    }

    beginShape(mode = C.TESS) { this._shape = { mode, v: [], uv: [], c: [] }; }
    vertex(x, y, z = 0, u, v) {
      if (!this._shape) return;
      if (v === undefined && u !== undefined) { v = u; u = z; z = 0; }
      const s = this._shape;
      s.v.push(x, y, z);
      let uu = u ?? 0, vv = v ?? 0;
      if (this.textureMode === C.IMAGE && this._tex) { uu /= this._tex.width || 1; vv /= this._tex.height || 1; }
      s.uv.push(uu, vv);
      s.c.push(...this.curFillColor);
    }
    endShape() {
      const s = this._shape;
      this._shape = null;
      if (!s || !s.v.length) return;
      const n = s.v.length / 3;
      let order = [...Array(n).keys()];
      let mode = s.mode;
      if (mode === C.QUADS) {
        order = [];
        for (let i = 0; i + 3 < n; i += 4) order.push(i, i + 1, i + 2, i, i + 2, i + 3);
        mode = C.TRIANGLES;
      } else if (mode === C.QUAD_STRIP) {
        order = [];
        for (let i = 0; i + 3 < n; i += 2) order.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
        mode = C.TRIANGLES;
      } else if (mode === C.TESS || typeof mode !== 'number') {
        mode = C.TRIANGLE_FAN;
      }
      const pick = (src, k) => new Float32Array(order.flatMap(i => src.slice(i * k, i * k + k)));
      const buffers = {};
      for (const [name, data, size] of [['aPosition', pick(s.v, 3), 3], ['aTexCoord', pick(s.uv, 2), 2], ['aVertexColor', pick(s.c, 4), 4]]) {
        this._immediate ??= {};
        const buf = this._immediate[name] ??= ctx.createBuffer();
        ctx.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
        buffers[name] = { buf, size };
      }
      this._draw(buffers, () => gl.drawArrays(mode, 0, order.length), true);
    }
  }

  const glCanvas = new Graphics();

  // createGraphics(): a P2D graphics, drawn here with GL into a framebuffer of
  // its own. It has p5's 2D origin, top left with y down, so its rows are top
  // first as a 2D canvas's texture is. Fills, transforms, shapes and image()
  // draw; strokes and text don't.
  class Graphics2D {
    constructor(w, h) {
      this.width = w; this.height = h;
      this._fbo = new Framebuffer(glCanvas, { width: w, height: h, density, depth: false, antialias: 4 });
      this._fill = [255, 255, 255, 255]; this._doFill = true;
      this._matrix = mat4.create();
      this._stack = [];
      this._shape = null;
      this._tint = null;
      this.elt = { width: w * density, height: h * density, style: {} };
      this.canvas = this.elt;
      this.pixels = [];
      this._draw(() => glCanvas.clear(1, 1, 1, 0));
    }
    _draw(f) {
      this._fbo.begin();
      glCanvas.push();
      try {
        glCanvas.resetShader();
        glCanvas.noStroke();
        glCanvas.translate(-this.width / 2, -this.height / 2);
        mat4.multiply(glCanvas.uMVMatrix.mat4, glCanvas.uMVMatrix.mat4, this._matrix);
        if (this._doFill) glCanvas.fill(this._fill); else glCanvas.noFill();
        if (this._tint) glCanvas.tint(this._tint); else glCanvas.noTint();
        f();
      } finally {
        glCanvas.pop();
        this._fbo.end();
      }
    }
    pixelDensity() { return density; }
    background(...a) { const c = color(a).levels; this._draw(() => glCanvas.background(c)); }
    clear() { this._draw(() => glCanvas.clear()); }
    fill(...a) { this._fill = color(a).levels; this._doFill = true; }
    noFill() { this._doFill = false; }
    stroke() {} noStroke() {} strokeWeight() {} strokeCap() {} strokeJoin() {} smooth() {} noSmooth() {}
    tint(...a) { this._tint = color(a).levels; }
    noTint() { this._tint = null; }
    push() { this._stack.push({ m: mat4.clone(this._matrix), fill: this._fill, doFill: this._doFill, tint: this._tint }); }
    pop() { const st = this._stack.pop(); if (st) ({ m: this._matrix, fill: this._fill, doFill: this._doFill, tint: this._tint } = st); }
    translate(x, y) { mat4.translate(this._matrix, this._matrix, [x, y, 0]); }
    scale(x, y = x) { mat4.scale(this._matrix, this._matrix, [x, y, 1]); }
    rotate(a) { mat4.rotateZ(this._matrix, this._matrix, a); }
    resetMatrix() { mat4.identity(this._matrix); }
    rect(x, y, w, h = w) { this._draw(() => glCanvas.rect(x, y, w, h)); }
    square(x, y, s) { this.rect(x, y, s, s); }
    image(img, x = 0, y = 0, w, h) { this._draw(() => glCanvas.image(img, x, y, w, h)); }
    beginShape(mode) { this._shape = { mode, v: [] }; }
    vertex(x, y) { this._shape?.v.push(x, y); }
    endShape() {
      const sh = this._shape;
      this._shape = null;
      if (!sh || !sh.v.length) return;
      this._draw(() => {
        glCanvas.beginShape(sh.mode);
        for (let i = 0; i < sh.v.length; i += 2) glCanvas.vertex(sh.v[i], sh.v[i + 1], 0);
        glCanvas.endShape();
      });
    }
    loadPixels() { this._fbo.loadPixels(); this.pixels = this._fbo.pixels; }
    get(...a) { return this._fbo.get(...a); }
    remove() { this._fbo.remove(); }
    text() { throw new Error('text() isn\'t supported in node-gles3'); }
    textFont() { throw new Error('textFont() isn\'t supported in node-gles3'); }
  }

  // The sketch, as modules reach it through glCanvas._pInst
  const pInst = {
    ...C,
    _glAttributes: { antialias: true, alpha: true, depth: true },
    _renderer: glCanvas,
    width, height,
    createCapture(type, cb) {
      if (type !== C.VIDEO && typeof type !== 'object') throw new Error('createCapture() only takes VIDEO in node-gles3');
      const cap = new Capture(typeof type === 'function' ? type : cb);
      setImmediate(() => cap._start());
      return cap;
    },
    createVideo() { throw new Error('createVideo() isn\'t supported in node-gles3'); },
    createGraphics(w, h, renderer) {
      if (renderer === C.WEBGL) throw new Error('createGraphics(WEBGL) isn\'t supported in node-gles3');
      return new Graphics2D(w, h);
    },
    loadImage(url, ok, err) {
      opts.loadImage(url).then((img) => ok?.(img), (e) => { if (err) err(e); else console.error(e.message); });
      return new Image(1, 1);
    },
    createImage: (w, h) => new Image(w, h),
    createFramebuffer: (o) => new Framebuffer(glCanvas, o),
    color: (...a) => color(a),
    pixelDensity: (d) => glCanvas.pixelDensity(d),
    millis: () => performance.now(),
    registerMethod() {},
  };
  glCanvas._pInst = pInst;

  function p5() { throw new Error('a p5 sketch can\'t be made in node-gles3'); }
  Object.assign(p5, {
    Vector, Geometry, Image, Texture, Shader, Framebuffer, FramebufferTexture, Camera,
    Graphics, instance: pInst, disableFriendlyErrors: true,
    prototype: { registerMethod() {}, registerPreloadMethod() {} },
  });
  Object.assign(p5.prototype, C);

  return { glCanvas, p5, Image, ctx };
}

// Loads the patch, sizes everything from its Monitor, and shows that Monitor's
// input fullscreen every frame
function lichenMain(CFG, SOURCES, CLASSICS, WORKERS) {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const { createRequire } = process.getBuiltinModule('node:module');
  const { spawn } = process.getBuiltinModule('node:child_process');

  const args = process.argv.slice(2);
  const flag = (name) => args.includes(name);
  const option = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
  const windowed = flag('--windowed');
  const hidden = flag('--hidden');
  const maxFrames = Number(option('--frames') ?? 0);
  const capturePath = option('--capture');
  const dumpDir = option('--dump');
  const densityOption = option('--density');
  const fixedFps = Number(option('--fixed') ?? 0);
  const seed = option('--seed');

  // --fixed steps the clock modules read by exactly one frame per frame, and
  // --seed makes Math.random() repeat, so a render can be made again exactly
  const realNow = performance.now.bind(performance);
  let clock = 0;
  if (fixedFps) performance.now = () => clock;
  const seedRandom = () => {
    if (seed === undefined) return;
    let a = Number(seed) >>> 0;
    // mulberry32
    Math.random = () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    // and crypto.getRandomValues(), from the same sequence
    Object.defineProperty(globalThis.crypto, 'getRandomValues', {
      configurable: true, writable: true,
      value: (a) => {
        const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
        for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
        return a;
      },
    });
  };

  const here = typeof __dirname === 'string' ? __dirname : process.cwd();
  const gles3Dir = [process.env.NODE_GLES3, here, CFG.gles3Dir].find(d => d && fs.existsSync(path.join(d, 'gles3.js')));
  if (!gles3Dir) {
    console.error(`Can't find node-gles3: set NODE_GLES3 to its folder, or put this script in it (looked in ${[process.env.NODE_GLES3, here, CFG.gles3Dir].filter(Boolean).join(', ')})`);
    process.exit(1);
  }
  const gles3 = createRequire(path.join(gles3Dir, 'index.js'));
  const gl = gles3('./gles3.js');
  const glfw = gles3('./glfw3.js');
  const Window = hidden ? null : gles3('./window.js');
  const glm = gles3('gl-matrix');
  const { PNG } = gles3('pngjs');
  const jpeg = gles3('jpeg-js');

  const runClassic = lichenPageScope(CFG.pageUrl, WORKERS);
  const children = new Set();
  const quit = (code = 0) => {
    for (const c of children) c.kill();
    process.exit(code);
  };
  process.on('unhandledRejection', (e) => console.error('Unhandled:', e?.message ?? e));

  // --hidden renders with no window on screen, as for --capture with no
  // display, so it makes the context itself; otherwise node-gles3's Window
  let win;
  if (hidden) {
    glfw.init();
    glfw.defaultWindowHints();
    glfw.windowHint(glfw.CONTEXT_VERSION_MAJOR, 3);
    glfw.windowHint(glfw.CONTEXT_VERSION_MINOR, 3);
    glfw.windowHint(glfw.OPENGL_FORWARD_COMPAT, 1);
    glfw.windowHint(glfw.OPENGL_PROFILE, glfw.OPENGL_CORE_PROFILE);
    glfw.windowHint(glfw.VISIBLE, 0);
    const window = glfw.createWindow(64, 64, CFG.title, null, null);
    glfw.makeContextCurrent(window);
    gl.glewInit();
    win = { window, frame: 0, dim: [64, 64], render() { this.draw(); glfw.swapBuffers(window); this.frame++; } };
  } else {
    win = new Window({ title: CFG.title, fullscreen: !windowed, sync: 1, width: windowed ? 960 : undefined, height: windowed ? 720 : undefined });
  }

  // The webcam, through ffmpeg: RGBA frames, rows top first, at the size asked
  const openCapture = (w, h, onFrame) => {
    const input = process.env.LICHEN_CAMERA ? process.env.LICHEN_CAMERA.split(/\s+/).filter(Boolean)
      : process.platform === 'darwin' ? ['-f', 'avfoundation', '-framerate', '30', '-i', '0:none']
      : process.platform === 'win32' ? null
      : ['-f', 'v4l2', '-i', '/dev/video0'];
    if (!input) {
      console.warn('Camera: set LICHEN_CAMERA to ffmpeg input arguments for the webcam, e.g. "-f dshow -i video=<name>"');
      return { stop() {} };
    }
    const proc = spawn('ffmpeg', ['-loglevel', 'error', ...input, '-an', '-vf', `scale=${w}:${h}`, '-pix_fmt', 'rgba', '-f', 'rawvideo', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(proc);
    const size = w * h * 4;
    let buf = Buffer.alloc(0);
    proc.stdout.on('data', (chunk) => {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      while (buf.length >= size) {
        onFrame(new Uint8Array(buf.subarray(0, size)));
        buf = buf.subarray(size);
      }
    });
    proc.stderr.on('data', (d) => console.warn('Camera (ffmpeg):', String(d).trim()));
    proc.on('error', (e) => console.warn(`Camera: can't run ffmpeg (${e.code}), so the Camera outputs nothing`));
    proc.on('exit', () => children.delete(proc));
    return { stop() { proc.kill(); } };
  };
  // An image a module loads by URL, from where the page would fetch it
  const loadImage = async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`can't load ${url}: ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const decoded = bytes[0] === 0x89 ? PNG.sync.read(bytes) : jpeg.decode(bytes, { useTArray: true });
    const img = new p5.Image(decoded.width, decoded.height);
    img.pixels.set(decoded.data);
    return img;
  };

  // The Monitor, built alone from its node first, since its Width and Height
  // set the pixel density every framebuffer is made at
  let density = 1;
  const { glCanvas, p5, ctx } = lichenP5(gl, glm, { width: CFG.canvas[0], height: CFG.canvas[1], density, openCapture, loadImage });
  globalThis.p5 = p5;
  const load = lichenLoader(SOURCES, CLASSICS, runClassic);
  const { ConnectionGraph } = load(CFG.graphUrl);
  const { ProcessingPipeline } = load(CFG.pipelineUrl);
  const { createModuleByUid } = load(CFG.registryUrl);
  for (const url of CFG.moduleUrls) load(url);

  const monitorNode = CFG.patch.nodes.find(n => n.id === CFG.monitorId);
  const probe = new ConnectionGraph();
  probe.fromJSON({ nodes: [monitorNode], connections: [], controlConnections: [] },
    (uid, id, type) => createModuleByUid(uid, glCanvas, id, type));
  const monitorProbe = probe.nodes.get(CFG.monitorId);
  const outW = Math.round(monitorProbe.params.width?.value ?? CFG.canvas[0]);
  const outH = Math.round(monitorProbe.params.height?.value ?? CFG.canvas[1]);
  monitorProbe.dispose();
  // The patch renders at the Monitor's size, or past it on one side when the
  // Monitor isn't 4:3, and the picture is stretched to it as a recording is
  density = densityOption ? Number(densityOption) : Math.max(outW / CFG.canvas[0], outH / CFG.canvas[1]);
  glCanvas.pixelDensity(density);

  seedRandom();
  const pipeline = new ProcessingPipeline(glCanvas);
  pipeline.graph.fromJSON(CFG.patch, (uid, id, type) => {
    try {
      return createModuleByUid(uid, glCanvas, id, type);
    } catch (e) {
      console.error(`${type} (node ${id}) can't run here, so it is left out: ${e.message}`);
      glCanvas._resetTargets();
      return null;
    }
  });

  // A module that throws stops there, and the rest of the patch carries on
  for (const mod of pipeline.graph.nodes.values()) {
    const process_ = mod.process;
    mod.process = function (graph, g) {
      if (this._lichenFailed) return;
      try {
        process_.call(this, graph, g);
      } catch (e) {
        this._lichenFailed = true;
        console.error(`${this.type} (node ${this.id}) stopped: ${e.stack ?? e}`);
        glCanvas._resetTargets();
      }
    };
  }
  const monitor = pipeline.graph.nodes.get(CFG.monitorId);
  console.log(`${CFG.title}: ${pipeline.graph.nodes.size} modules, output ${outW}x${outH} (pixel density ${+density.toFixed(4)})`);

  // The final buffer, Monitor Width x Height, and the passes into and out of it.
  // Row 0 of a framebuffer is the top of its picture (see Framebuffer
  // Orientation in ARCHITECTURE.md), so the copy into it flips v and the final
  // buffer is the right way up for GL.
  const prog = (frag) => {
    const compile = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, '#version 330\nin vec2 aPosition; out vec2 vUv; uniform float uFlip;\nvoid main() { vUv = vec2(aPosition.x, uFlip > 0.5 ? 1.0 - aPosition.y : aPosition.y); gl_Position = vec4(aPosition * 2.0 - 1.0, 0.0, 1.0); }'));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, frag));
    gl.bindAttribLocation(p, 0, 'aPosition');
    gl.linkProgram(p);
    return p;
  };
  const copyProg = prog('#version 330\nin vec2 vUv; out vec4 color; uniform sampler2D uTex;\nvoid main() { color = texture(uTex, vUv); }');
  const quadVao = gl.createVertexArray();
  gl.bindVertexArray(quadVao);
  const quadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(0);
  const finalFbo = glCanvas.createFramebuffer({ width: outW, height: outH, density: 1, antialias: false, depth: false });

  const drawQuad = (tex, flip) => {
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    ctx.useProgram(copyProg);
    ctx.activeTexture(gl.TEXTURE0);
    ctx.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(gl.getUniformLocation(copyProg, 'uTex'), 0);
    gl.uniform1f(gl.getUniformLocation(copyProg, 'uFlip'), flip ? 1 : 0);
    ctx.bindVertexArray(quadVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.enable(gl.DEPTH_TEST);
    glCanvas._forgetGLState();
  };

  const show = () => {
    const src = monitor?.displayTexture;
    ctx.bindFramebuffer(gl.FRAMEBUFFER, finalFbo.framebuffer);
    ctx.viewport(0, 0, outW, outH);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (src && src.colorTexture) drawQuad(src.colorTexture, true);

    // Into the window, letterboxed to the Monitor's aspect
    const [ww, wh] = win.dim;
    const scale = Math.min(ww / outW, wh / outH);
    const vw = Math.round(outW * scale), vh = Math.round(outH * scale);
    ctx.bindFramebuffer(gl.FRAMEBUFFER, null);
    ctx.viewport(0, 0, ww, wh);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    ctx.viewport(Math.floor((ww - vw) / 2), Math.floor((wh - vh) / 2), vw, vh);
    drawQuad(finalFbo.colorTexture, false);
  };

  const savePng = (file) => {
    finalFbo.loadPixels();
    const png = new PNG({ width: outW, height: outH });
    const row = outW * 4;
    for (let y = 0; y < outH; y++) png.data.set(finalFbo.pixels.subarray((outH - 1 - y) * row, (outH - y) * row), y * row);
    fs.writeFileSync(file, PNG.sync.write(png));
    console.log(`Saved ${file}`);
  };
  // Every framebuffer each node holds as <dir>/<id>-<type>-<property>.png,
  // rows as stored: top first
  const dumpOutputs = (dir) => {
    fs.mkdirSync(dir, { recursive: true });
    for (const mod of pipeline.graph.nodes.values()) {
      for (const [prop, fbo] of Object.entries(mod)) {
        if (!(fbo instanceof p5.Framebuffer)) continue;
        fbo.loadPixels();
        const w = fbo._pw, h = fbo._ph;
        const png = new PNG({ width: w, height: h });
        const px = fbo.pixels;
        for (let i = 0; i < w * h * 4; i++) png.data[i] = px instanceof Float32Array ? Math.max(0, Math.min(255, px[i] * 255)) : px[i];
        fs.writeFileSync(path.join(dir, `${mod.id}-${mod.type}-${prop}.png`), PNG.sync.write(png));
      }
    }
    console.log(`Saved every node's framebuffers in ${dir}`);
  };

  win.draw = () => {
    if (fixedFps) clock += 1000 / fixedFps;
    pipeline.processFrame();
    show();
  };
  const frame = () => {
    const start = realNow();
    glfw.pollEvents();
    if (glfw.windowShouldClose(win.window) || glfw.getKey(win.window, glfw.KEY_ESCAPE)) return quit();
    win.render(gl);
    if (maxFrames && win.frame >= maxFrames) {
      if (capturePath) savePng(capturePath);
      if (dumpDir) dumpOutputs(dumpDir);
      return quit();
    }
    // A hidden window has no vsync to wait on, and modules that move by the
    // clock would see frames come far faster than a display shows them
    if (hidden && !fixedFps) setTimeout(frame, Math.max(0, 1000 / 60 - (realNow() - start)));
    else setImmediate(frame);
  };
  frame();
}

// ---------------------------------------------------------------------------
// Conversion

function convert(opts) {
  let patch;
  try {
    patch = JSON.parse(fs.readFileSync(opts.patch, 'utf8'));
  } catch (e) {
    fail(`can't read ${opts.patch}: ${e.message}`);
  }
  if (!Array.isArray(patch.nodes) || !Array.isArray(patch.connections)) fail(`${opts.patch} isn't a LICHEN patch`);

  const byUid = registeredModules();
  const files = new Set();
  for (const node of patch.nodes) {
    if (node.uid === undefined) fail(`${node.type} has no uid: the patch predates ids, so convert it with tools/convert-workflows.mjs first`);
    const mod = byUid.get(node.uid) ?? fail(`no module has uid ${node.uid} (saved as ${node.type})`);
    if (mod.name !== node.type) console.log(`${node.type} (node ${node.id}) is now ${mod.name}`);
    files.add(mod.file);
  }

  // The Monitor whose input is shown
  const monitorUid = [...byUid].find(([, m]) => m.name === 'Monitor')?.[0] ?? fail('js/main.js registers no Monitor');
  const monitors = patch.nodes.filter(n => n.uid === monitorUid);
  if (!monitors.length) fail(`${opts.patch} has no Monitor to show`);
  let monitor;
  if (opts.monitor !== null) {
    monitor = monitors.find(n => n.id === opts.monitor) ?? fail(`node ${opts.monitor} isn't a Monitor`);
  } else {
    monitor = monitors.find(n => patch.connections.some(c => c.toId === n.id)) ?? monitors[0];
    if (monitors.length > 1) console.log(`Showing Monitor ${monitor.id} of ${monitors.length}; --monitor picks another`);
  }

  const gles3Dir = opts.gles3 ? path.resolve(opts.gles3) : findGles3();
  if (!gles3Dir) console.warn('No node-gles3 folder found beside this repo; the output will need NODE_GLES3 set, or to sit in node-gles3');
  else if (!fs.existsSync(path.join(gles3Dir, 'gles3.js'))) fail(`${gles3Dir} has no gles3.js`);

  const main = new Bundle();
  const graphUrl = main.add(path.join(JS, 'graph.js'));
  const pipelineUrl = main.add(path.join(JS, 'pipeline.js'));
  const registryUrl = main.add(path.join(JS, 'moduleRegistry.js'));
  const moduleUrls = [...files].map(f => main.add(f));
  main.check();

  const workers = {};
  for (let pending = [...main.workers]; pending.length;) {
    const file = pending.shift();
    const url = pathToFileURL(file).href;
    if (url in workers) continue;
    const wb = new Bundle();
    const entry = wb.add(file);
    wb.check();
    pending.push(...wb.workers);
    workers[url] = [
      '"use strict";',
      `const lichenLoader = ${lichenLoader};`,
      `const lichenWebScope = ${lichenWebScope};`,
      `const lichenRunClassic = ${lichenRunClassic};`,
      `const lichenWorkerScope = ${lichenWorkerScope};`,
      wb.emit(),
      `lichenLoader(SOURCES, CLASSICS, lichenWorkerScope())(${JSON.stringify(entry)});`,
    ].join('\n');
  }

  const title = path.basename(opts.patch, path.extname(opts.patch));
  const cfg = {
    title, patch, monitorId: monitor.id, canvas: canvasSize(), gles3Dir,
    pageUrl: pathToFileURL(path.join(ROOT, 'index.html')).href,
    graphUrl, pipelineUrl, registryUrl, moduleUrls,
  };
  const names = [...new Set(patch.nodes.map(n => byUid.get(n.uid).name))].sort();

  const out = [
    '#!/usr/bin/env node',
    `// ${title}: a LICHEN patch for node-gles3, made by tools/patch-to-gles3.mjs from`,
    `// ${path.resolve(opts.patch)}`,
    `// on ${new Date().toISOString()}. Don't edit it: convert the patch again.`,
    '//',
    `// Modules: ${names.join(', ')}`,
    `// Shows Monitor ${monitor.id} fullscreen; Escape quits.`,
    '//',
    '//   node this.js [--windowed | --hidden] [--frames <n>] [--capture <file.png>] [--dump <dir>]',
    '//                [--fixed <fps>] [--seed <n>] [--density <d>]',
    '// (see tools/patch-to-gles3.mjs in LICHEN for what each does)',
    '//',
    '// It needs node-gles3, found in $NODE_GLES3, beside this file, or at',
    `// ${gles3Dir ?? '(no folder given)'}`,
    '// A Camera reads the webcam through ffmpeg; $LICHEN_CAMERA replaces its input arguments.',
    '',
    '"use strict";',
    `const CFG = ${JSON.stringify(cfg)};`,
    main.emit(),
    `const WORKERS = ${JSON.stringify(workers)};`,
    '',
    `const lichenLoader = ${lichenLoader};`,
    `const lichenWebScope = ${lichenWebScope};`,
    `const lichenRunClassic = ${lichenRunClassic};`,
    `const lichenPageScope = ${lichenPageScope};`,
    `const lichenP5 = ${lichenP5};`,
    `const lichenMain = ${lichenMain};`,
    '',
    'lichenMain(CFG, SOURCES, CLASSICS, WORKERS);',
    '',
  ].join('\n');
  fs.writeFileSync(opts.out, out);
  console.log(`${opts.out}: ${patch.nodes.length} nodes (${names.length} modules), ${main.modules.size + main.classics.size} files bundled, Monitor ${monitor.id}`);
}

convert(parseArgs(process.argv.slice(2)));
