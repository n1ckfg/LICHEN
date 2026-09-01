import { Module } from './Module.js';
import { vertSrc } from '../shaders/vert.js';
import {
  inkDropsBakeFrag, inkDropsLiftFrag, inkDropsMainFrag,
  INK_MAXD, INK_MAXR, INK_RING_LIFE,
} from '../shaders/inkdrops.js';
import { registerModule } from '../moduleRegistry.js';

const MAXD = INK_MAXD;          // wet drops uploaded per pass
const MAXR = INK_MAXR;          // solvent-wipe slots
const MAX_DT = 0.05;            // clamp long stalls so a tab switch doesn't jump the clock
const BAKE_AGE = 3.5;           // seconds before an ordinary splash stamps into the paper
const AUTO_SPAWN_MIN = 0.35;    // seconds between automatic splashes
const AUTO_SPAWN_MAX = 1.1;
const INITIAL_BURST = 12;
const STAIN_MIN = 5.5;          // seconds between the big falling stains
const STAIN_MAX = 10.0;
const RING_LIFE = INK_RING_LIFE;
const RING_STAGGER = 2.25;      // seconds between automatic wipes
const RING_CLICK_GAP = 0.7;     // min seconds between click-spawned wipes
const RING_LIFT = 1.6;          // how fast the solvent lifts pigment, per second
const RING_CAP = 8;             // live wipes; the spare slots let retired ones fade out
const RING_RETIRE = 1.0;        // seconds a wipe takes to fade when its slot is claimed

// Per-drop wobble, applied in HSV so a jittered drop stays inside the hue family
const JITTER_HUE = 0.018;
const JITTER_SAT = 0.06;
const JITTER_VAL = 0.06;

// Source palettes. These are re-cast into the hue family the knobs describe by
// harmonize() below, which keeps each palette's internal spacing but squeezes
// its widest deviation down to the spreads it is given.
const PALETTE = [
  [0.93, 0.10, 0.52], // magenta
  [0.86, 0.08, 0.68], // fuchsia
  [0.82, 0.06, 0.30], // crimson
  [0.55, 0.12, 0.78], // purple
  [0.38, 0.16, 0.86], // violet
  [0.16, 0.34, 0.92], // indigo
  [0.06, 0.62, 0.92], // cyan
  [0.04, 0.78, 0.76], // teal
  [0.10, 0.74, 0.48], // viridian
  [0.98, 0.48, 0.06], // orange
  [0.96, 0.24, 0.13], // vermilion
  [0.99, 0.70, 0.10], // amber
  [0.15, 0.85, 0.55], // mint
  [0.20, 0.90, 0.80], // teal bright
  [0.85, 0.10, 0.65], // fuchsia deep
  [0.10, 0.35, 0.90], // indigo deep
];

// A muted pigment wheel: the big stains stay quieter than the splashes
const STAIN_PALETTE = [
  [0.16, 0.26, 0.56], // indigo
  [0.10, 0.50, 0.55], // teal
  [0.60, 0.20, 0.50], // magenta
  [0.78, 0.22, 0.30], // crimson
  [0.85, 0.55, 0.15], // amber
  [0.16, 0.45, 0.30], // forest
];

const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

function rgb2hsv(c) {
  const r = c[0], g = c[1], b = c[2];
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-6) {
    if (mx === r) h = ((g - b) / d + 6) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, mx > 1e-6 ? d / mx : 0, mx];
}

function hsv2rgb(h, s, v) {
  h = ((h % 1) + 1) % 1;
  s = clamp01(s); v = clamp01(v);
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    default: return [v, p, q];
  }
}

// Pull a set of values toward `center`, keeping their relative spacing intact
// but squeezing the widest deviation down to `spread`.
function tighten(vals, center, spread) {
  let mean = 0;
  for (let i = 0; i < vals.length; i++) mean += vals[i];
  mean /= vals.length;
  let widest = 0;
  for (let i = 0; i < vals.length; i++) widest = Math.max(widest, Math.abs(vals[i] - mean));
  const k = widest > 1e-6 ? spread / widest : 0;
  return vals.map(v => center + (v - mean) * k);
}

// Re-cast a palette into one hue family. Hues are handled on the circle, so a
// palette straddling the red seam still compresses correctly.
function harmonize(palette, o) {
  const hsv = palette.map(rgb2hsv);
  let sx = 0, sy = 0;
  for (let i = 0; i < hsv.length; i++) { sx += Math.cos(hsv[i][0] * TAU); sy += Math.sin(hsv[i][0] * TAU); }
  const meanH = Math.atan2(sy, sx) / TAU;
  const dh = hsv.map(c => { const d = c[0] - meanH; return d - Math.round(d); });   // wrap to [-.5,.5]

  const hs = tighten(dh, 0, o.hueSpread);
  const ss = tighten(hsv.map(c => c[1]), o.sat, o.satSpread);
  const vs = tighten(hsv.map(c => c[2]), o.val, o.valSpread);
  return hsv.map((_, i) => hsv2rgb(o.hue + o.hueShift + hs[i], ss[i], vs[i]));
}

export class InkDropsModule extends Module {
  constructor(glCanvas, id) {
    super('InkDrops', glCanvas, id);
    this.inputs = [];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      speed: { value: 1.0, min: 0, max: 3, step: 0.01, label: 'Speed' },
      rate: { value: 1.0, min: 0.1, max: 4, step: 0.05, label: 'Rate' },
      size: { value: 1.0, min: 0.3, max: 2.5, step: 0.05, label: 'Size' },
      stains: { value: 3, min: 0, max: 6, step: 1, label: 'Stains' },
      wipes: { value: 1.0, min: 0, max: 3, step: 0.05, label: 'Wipes' },
      fade: { value: 40, min: 5, max: 120, step: 1, label: 'Fade' },
      hue: { value: 0.58, min: 0, max: 1, step: 0.01, label: 'Hue' },
      hueVar: { value: 0.085, min: 0, max: 0.5, step: 0.005, label: 'Hue Var' },
      sat: { value: 0.80, min: 0, max: 1, step: 0.01, label: 'Sat' },
      grain: { value: 1.0, min: 0, max: 3, step: 0.01, label: 'Grain' },
    };

    this.bakeShader = glCanvas.createShader(vertSrc, inkDropsBakeFrag);
    this.liftShader = glCanvas.createShader(vertSrc, inkDropsLiftFrag);
    this.mainShader = glCanvas.createShader(vertSrc, inkDropsMainFrag);
    this.createOutputFBO();

    // The sheet: everything that has already soaked in. Two buffers ping-pong,
    // since every pass reads the whole sheet to write the next one.
    this.hasFloat = false;
    this.accumA = this._createSheetFBO(glCanvas);
    this.accumB = this._createSheetFBO(glCanvas);

    // Uniform staging, reused every frame
    this.bufA = new Float32Array(MAXD * 4);
    this.bufB = new Float32Array(MAXD * 4);
    this.bufC = new Float32Array(MAXD * 4);
    this.bufR = new Float32Array(MAXR * 4);
    this.bufRB = new Float32Array(MAXR * 4);

    // Scaled time is accumulated rather than derived from an absolute clock, so
    // turning the speed knob changes the rate without jumping the animation.
    this.time = 0;
    this.lastTime = performance.now() / 1000;
    this.pendingFade = 0;
    this.liftActive = false;   // forces one last pass to clear alpha after the final wipe dies

    this.drops = [];
    this.queue = [];           // splashes waiting their turn
    this.rings = [];
    this.nextSpawn = 0;
    this.nextStain = 4.0;
    this.nextRing = 1.2;
    this.lastRingClick = -99;

    this._themeKey = null;
    this._syncTheme();
    // The sheet starts as bare paper, which takes a GL pass, so the first
    // process() clears it and lays down the opening burst.
    this._pendingClear = true;
  }

  // Half-float keeps the sheet from banding as pass after pass multiplies into
  // it; without it the evaporation step has to wait until it is big enough to
  // survive 8-bit quantisation (see the uAmt guard in process()).
  _createSheetFBO(glCanvas) {
    const gl = glCanvas.drawingContext;
    const webgl2 = glCanvas._renderer && glCanvas._renderer.webglVersion === 'webgl2';
    if (webgl2 && gl && gl.getExtension &&
        (gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'))) {
      try {
        const fbo = glCanvas.createFramebuffer({ channels: glCanvas.RGBA, format: glCanvas.HALF_FLOAT });
        this.hasFloat = true;
        return fbo;
      } catch (e) {
        this.hasFloat = false;
      }
    }
    return glCanvas.createFramebuffer({ channels: glCanvas.RGBA });
  }

  // Re-cast both palettes whenever the colour knobs move.
  _syncTheme() {
    const hue = this.params.hue.value;
    const sat = this.params.sat.value;
    const hueVar = this.params.hueVar.value;
    const key = `${hue}|${sat}|${hueVar}`;
    if (key === this._themeKey) return;
    this._themeKey = key;
    this.splashCols = harmonize(PALETTE, {
      hue, hueShift: 0, hueSpread: hueVar,
      sat, satSpread: 0.13, val: 0.88, valSpread: 0.10,
    });
    this.stainCols = harmonize(STAIN_PALETTE, {
      hue, hueShift: -0.035, hueSpread: hueVar * 0.8,
      sat: sat * 0.625, satSpread: 0.10, val: 0.68, valSpread: 0.09,
    });
  }

  // The opening burst, so the sheet is never blank for long
  _seed() {
    for (let i = 0; i < INITIAL_BURST; i++) this.schedule(i * 0.18, {});
    this.queue.push({ at: this.time + 0.9, stain: true });
  }

  pick() { return this.splashCols[(Math.random() * this.splashCols.length) | 0]; }
  pickStain() { return this.stainCols[(Math.random() * this.stainCols.length) | 0]; }

  inkColor(base) {
    const c = rgb2hsv(base || this.pick());
    return hsv2rgb(c[0] + rnd(-JITTER_HUE, JITTER_HUE),
                   c[1] + rnd(-JITTER_SAT, JITTER_SAT),
                   c[2] + rnd(-JITTER_VAL, JITTER_VAL));
  }

  schedule(delay, o) { this.queue.push({ at: this.time + delay, o: o || {} }); }

  spawn(o) {
    o = o || {};
    const scale = this.params.size.value;
    const x = o.x !== undefined ? o.x : rnd(0.04, 0.96);
    const y = o.y !== undefined ? o.y : rnd(0.06, 0.94);
    this.drops.push({
      baseX: x,
      baseY: y,
      rMax: (o.rMax !== undefined ? o.rMax
           : (Math.random() < 0.14 ? rnd(0.13, 0.20) : rnd(0.045, 0.115))) * scale,
      hitT: this.time,
      seed: rnd(0, 90),
      col: o.col || this.inkColor(o.base),
      soft: o.soft ? 1 : 0,
      fall: o.fall || 0,                // seconds spent in the air before soaking
      fromY: o.fromY !== undefined ? o.fromY : y,
      fragMax: o.frag !== undefined ? o.frag : rnd(0.0, 0.18),
      tendrilMax: o.tendrilMax !== undefined ? o.tendrilMax : rnd(0.30, 0.85),
      aspect: o.aspect !== undefined ? o.aspect : 1.0,   // permanent squash bias
      bake: o.bake !== undefined ? o.bake : BAKE_AGE,
      load: o.load !== undefined ? o.load : rnd(0.85, 1.35),   // pigment carried
      sag: o.sag !== undefined ? o.sag : rnd(0.004, 0.020),    // gravity pull while settling
      splat: rnd(0.18, 0.36),           // how flat the initial impact spreads it
      wobW: rnd(12.0, 19.0),            // settling wobble rate
      satellites: o.satellites !== undefined ? o.satellites
                : (Math.random() < 0.55 ? 1 + ((Math.random() * 2) | 0) : 0),
      splashed: false,
      x, y, r: 0, squash: 1, tendril: 0, frag: 0, strength: 0,
    });
  }

  // A knot of drops landing together
  cluster(x, y) {
    const base = this.pick(), alt = this.pick();
    const n = 5 + ((Math.random() * 5) | 0);
    for (let i = 0; i < n; i++) {
      const a = rnd(0, 6.283);
      const rad = Math.pow(Math.random(), 0.65) * 0.16;
      this.schedule(i === 0 ? 0 : rnd(0.02, 0.26), {
        x: clamp01(x + Math.cos(a) * rad),
        y: clamp01(y + Math.sin(a) * rad * 0.75),
        rMax: i === 0 ? rnd(0.09, 0.155) : rnd(0.025, 0.095),
        base: Math.random() < 0.7 ? base : alt,
      });
    }
  }

  // An impact that shatters outward into small, torn, elongated shards
  splash(x, y) {
    const base = this.pick(), alt = this.pick();
    this.schedule(0, { x: clamp01(x), y: clamp01(y), rMax: rnd(0.06, 0.115),
                       base, frag: rnd(0.28, 0.50), tendrilMax: rnd(0.55, 1.05), satellites: 0 });

    const n = 8 + ((Math.random() * 8) | 0);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.283 + rnd(-0.30, 0.30);
      const dist = 0.05 + Math.pow(Math.random(), 0.55) * 0.24;
      this.schedule(rnd(0.0, 0.20), {
        x: clamp01(x + Math.cos(a) * dist),
        y: clamp01(y + Math.sin(a) * dist * 0.82),
        rMax: rnd(0.008, 0.042),
        base: Math.random() < 0.72 ? base : alt,
        frag: rnd(0.55, 1.0),                 // torn to pieces at the rim
        tendrilMax: rnd(0.70, 1.40),          // long capillary fingers off each shard
        aspect: rnd(0.45, 1.85),              // flung shards are not round
        load: rnd(0.70, 1.15),
        bake: rnd(1.6, 2.6),                  // small and thin, so they dry fast
        satellites: 0,
      });
    }
  }

  // A fat drop falls in from off-screen, lands, and soaks out huge
  bigStain() {
    this.spawn({
      x: rnd(0.10, 0.90),
      y: rnd(0.18, 0.78),
      rMax: rnd(0.22, 0.42),
      base: this.pickStain(),
      soft: true,
      fall: rnd(0.8, 1.4),
      fromY: 1.14,
      load: rnd(0.46, 0.80),
      sag: rnd(0.010, 0.030),
      bake: rnd(8.0, 11.0),
      satellites: 0,
      frag: 0,
    });
  }

  stainCount() {
    let n = 0;
    for (let i = 0; i < this.drops.length; i++) if (this.drops[i].soft) n++;
    return n;
  }

  // returns seconds since the drop landed (negative while it is still falling)
  updateDrop(d) {
    const a = this.time - d.hitT;

    if (d.fall > 0 && a < d.fall) {
      const ft = a / d.fall;
      d.x = d.baseX + Math.sin(ft * 5.0 + d.seed) * 0.008;
      d.y = d.fromY + (d.baseY - d.fromY) * ft * ft;   // accelerating like gravity
      d.r = d.rMax * (0.10 + 0.10 * ft);
      d.squash = 2.10 - 0.90 * ft;                     // stretched streak, relaxing on impact
      d.tendril = 0;
      d.frag = 0;
      d.strength = 0.45 * d.load;
      return a - d.fall;
    }

    const s = a - d.fall;
    d.x = d.baseX;

    if (!d.splashed) {
      d.splashed = true;
      for (let i = 0; i < d.satellites; i++) {
        const ang = rnd(0, 6.283), dist = d.rMax * rnd(1.3, 2.8);
        this.schedule(rnd(0.03, 0.14), {                  // flung off, landing just after
          x: clamp01(d.baseX + Math.cos(ang) * dist),
          y: clamp01(d.baseY + Math.sin(ang) * dist * 0.8),
          rMax: d.rMax * rnd(0.10, 0.30), col: d.col, satellites: 0,
        });
      }
    }

    const e = 1.0 - Math.exp(-s * (d.soft ? 0.55 : 2.2));   // settle curve: slow soak / fast bloom

    if (d.soft) {
      d.r = d.rMax * (0.16 + 0.84 * e);
      d.squash = d.aspect * (1.0 - 0.12 * Math.exp(-s * 1.2));
      d.tendril = 0;
      d.frag = 0;
      d.strength = (0.35 + 0.65 * e) * d.load;
    } else {
      d.r = d.rMax * (0.34 + 0.66 * e) * (1.0 + 0.11 * Math.exp(-s * 3.2) * Math.sin(s * 14.0));
      d.squash = d.aspect * (1.0 - d.splat * Math.exp(-s * 4.5) * Math.cos(s * d.wobW));
      d.tendril = d.tendrilMax * (0.22 + 0.78 * e);
      d.frag = d.fragMax * (0.35 + 0.65 * e);            // shards tear apart as they spread
      d.strength = (0.55 + 0.55 * e) * d.load;
    }
    d.y = d.baseY - d.sag * e;
    return s;
  }

  // 1 while the wipe is alive, easing to 0 across RING_RETIRE once it is retired
  ringFade(r) {
    if (!r.retired) return 1.0;
    const k = (this.time - r.retired) / RING_RETIRE;
    return k >= 1.0 ? 0.0 : 1.0 - k * k * (3.0 - 2.0 * k);
  }

  addRing(px, py) {
    // Never yank a visible wipe: retire the oldest and let it fade in a spare slot.
    let live = 0;
    for (let i = 0; i < this.rings.length; i++) if (!this.rings[i].retired) live++;
    if (live >= RING_CAP) {
      let oldest = -1;
      for (let i = 0; i < this.rings.length; i++) {
        if (!this.rings[i].retired && (oldest < 0 || this.rings[i].t0 < this.rings[oldest].t0)) oldest = i;
      }
      if (oldest >= 0) this.rings[oldest].retired = this.time;
    }
    // click spam can still outrun the spare slots; drop the faintest, never a fresh one
    while (this.rings.length >= MAXR) {
      let faint = 0;
      for (let i = 1; i < this.rings.length; i++) {
        if (this.ringFade(this.rings[i]) < this.ringFade(this.rings[faint])) faint = i;
      }
      this.rings.splice(faint, 1);
    }
    this.rings.push({ x: px, y: py, seed: Math.random(), t0: this.time, retired: 0 });
  }

  autoRing() {
    const halfX = 0.5 * (this.glCanvas.width / this.glCanvas.height);
    this.addRing(rnd(-halfX, halfX) * 0.85, rnd(-0.5, 0.5) * 0.85);
  }

  pack(list) {
    const n = Math.min(list.length, MAXD);
    for (let i = 0; i < n; i++) {
      const d = list[i], o = i * 4;
      this.bufA[o] = d.x;        this.bufA[o + 1] = d.y;      this.bufA[o + 2] = d.r;      this.bufA[o + 3] = d.seed;
      this.bufB[o] = d.strength; this.bufB[o + 1] = d.frag;   this.bufB[o + 2] = d.squash; this.bufB[o + 3] = d.tendril;
      this.bufC[o] = d.col[0];   this.bufC[o + 1] = d.col[1]; this.bufC[o + 2] = d.col[2]; this.bufC[o + 3] = d.soft;
    }
    return n;
  }

  packRings() {
    const n = Math.min(this.rings.length, MAXR);
    for (let i = 0; i < n; i++) {
      const r = this.rings[i], o = i * 4;
      this.bufR[o] = r.x; this.bufR[o + 1] = r.y; this.bufR[o + 2] = this.time - r.t0; this.bufR[o + 3] = r.seed;
      this.bufRB[o] = this.ringFade(r);
    }
    return n;
  }

  _uploadDrops(shader, n) {
    shader.setUniform('uA', this.bufA);
    shader.setUniform('uB', this.bufB);
    shader.setUniform('uC', this.bufC);
    shader.setUniform('uCount', n);
  }

  _uploadRings(shader, n) {
    shader.setUniform('uRing', this.bufR);
    shader.setUniform('uRingB', this.bufRB);
    shader.setUniform('uRingCount', n);
  }

  // One full-screen pass into `target`. REPLACE is needed because these shaders
  // write meaningful alpha (the wipe coverage), which p5's default blend would
  // fold into the colour instead; framebuffer end() pops it back afterwards.
  _pass(shader, target, setup) {
    const g = this.glCanvas;
    target.begin();
    g.clear();
    g.blendMode(g.REPLACE);
    g.shader(shader);
    // Every pass works in gl_FragCoord space, so uRes carries the framebuffer's
    // pixel density (see Module.fragResolution) -- with the logical size the
    // whole sheet is squeezed into one quadrant and the feedback passes read
    // off the edge.
    shader.setUniform('uRes', this.fragResolution());
    setup(shader);
    this.renderQuad();
    target.end();
  }

  _swapSheets() {
    const t = this.accumA;
    this.accumA = this.accumB;
    this.accumB = t;
  }

  // Bare paper: the lift shader with a full step of evaporation and no wipes
  // resolves to white with zero coverage, whatever the buffer held before.
  clear() {
    this.drops.length = 0;
    this.queue.length = 0;
    this.rings.length = 0;
    this.pendingFade = 0;
    for (let i = 0; i < 2; i++) {
      this._pass(this.liftShader, this.accumB, sh => {
        sh.setUniform('uSrc', this.accumA);
        sh.setUniform('uAmt', 1.0);
        sh.setUniform('uLift', 0.0);
        this._uploadRings(sh, 0);
      });
      this._swapSheets();
    }
  }

  process(graph, glCanvas) {
    const now = performance.now() / 1000;
    const dt = Math.min(now - this.lastTime, MAX_DT) * this.params.speed.value;
    this.lastTime = now;
    this._syncTheme();

    if (this._pendingClear) {
      this._pendingClear = false;
      this.clear();
      this._seed();
    }

    // update, then split into still-wet (drawn live) and settled (stamped down)
    const wet = [], bake = [];

    if (dt > 0) {
      this.time += dt;

      for (let i = this.queue.length - 1; i >= 0; i--) {
        if (this.time >= this.queue[i].at) {
          const q = this.queue[i];
          this.queue.splice(i, 1);
          if (q.stain) { if (this.params.stains.value >= 1) this.bigStain(); }
          else this.spawn(q.o);
        }
      }
      if (this.time > this.nextSpawn) {
        this.nextSpawn = this.time + rnd(AUTO_SPAWN_MIN, AUTO_SPAWN_MAX) / this.params.rate.value;
        this.spawn();
      }
      if (this.time > this.nextStain) {
        this.nextStain = this.time + rnd(STAIN_MIN, STAIN_MAX);
        if (this.stainCount() < this.params.stains.value) this.bigStain();
      }
      if (this.time > this.nextRing) {
        const wipes = this.params.wipes.value;
        this.nextRing = this.time + RING_STAGGER * rnd(0.7, 1.4) / Math.max(wipes, 0.05);
        if (wipes > 0) this.autoRing();
      }
      for (let i = this.rings.length - 1; i >= 0; i--) {
        const r = this.rings[i];
        if (this.time - r.t0 >= RING_LIFE || (r.retired && this.time - r.retired >= RING_RETIRE)) {
          this.rings.splice(i, 1);
        }
      }

      for (let i = this.drops.length - 1; i >= 0; i--) {
        const d = this.drops[i];
        if (this.updateDrop(d) >= d.bake) {
          bake.push(d);
          this.drops.splice(i, 1);
        } else {
          wet.push(d);
        }
      }
      // hard cap: retire the oldest wet drops (newest are first, having iterated backwards)
      while (wet.length > MAXD) {
        const d = wet.pop();
        const k = this.drops.indexOf(d);
        if (k >= 0) this.drops.splice(k, 1);
        bake.push(d);
      }
    } else {
      for (let i = 0; i < this.drops.length && wet.length < MAXD; i++) wet.push(this.drops[i]);
    }

    // Evaporation + the solvent wipe. Evaporation alone can wait for a step big
    // enough to survive 8-bit quantisation, but an active wipe needs the pass
    // every frame, so it runs on either trigger and only banks the fade when the
    // step was actually large enough to apply.
    if (dt > 0) {
      this.pendingFade += dt / this.params.fade.value;
      const ringsNow = this.rings.length > 0;
      const fadeReady = this.pendingFade > (this.hasFloat ? 0.0 : 0.006);
      if (fadeReady || ringsNow || this.liftActive) {
        const n = this.packRings();
        this._pass(this.liftShader, this.accumB, sh => {
          sh.setUniform('uSrc', this.accumA);
          sh.setUniform('uAmt', fadeReady ? this.pendingFade : 0.0);
          sh.setUniform('uLift', RING_LIFT * dt);
          this._uploadRings(sh, n);
        });
        this._swapSheets();
        if (fadeReady) this.pendingFade = 0;
      }
      this.liftActive = ringsNow;
    }

    // stamp settled drops into the sheet
    if (bake.length) {
      const n = this.pack(bake);
      this._pass(this.bakeShader, this.accumB, sh => {
        sh.setUniform('uSrc', this.accumA);
        this._uploadDrops(sh, n);
      });
      this._swapSheets();
      for (let i = MAXD; i < bake.length; i++) this.drops.push(bake[i]);   // overflow waits a frame
    }

    // composite
    const n = this.pack(wet);
    this._pass(this.mainShader, this.outputFBO, sh => {
      sh.setUniform('uAccum', this.accumA);
      sh.setUniform('uTime', this.time);
      sh.setUniform('uGrain', this.params.grain.value);
      this._uploadDrops(sh, n);
    });
  }

  // Map a click on the fullscreen canvas to sheet uv, accounting for the
  // letterboxing (same fit as Conway) and for the flipped y in sheetUV().
  getSheetUV(canvasX, canvasY, canvasW, canvasH) {
    const aspect = this.glCanvas.width / this.glCanvas.height;
    let dw = canvasW;
    let dh = canvasW / aspect;
    if (dh > canvasH) {
      dh = canvasH;
      dw = canvasH * aspect;
    }
    const dx = (canvasW - dw) / 2;
    const dy = (canvasH - dh) / 2;
    return [(canvasX - dx) / dw, 1.0 - (canvasY - dy) / dh];
  }

  // Fullscreen only: a click throws a cluster, a splash and (at most every
  // RING_CLICK_GAP seconds) a wipe. ESC exits fullscreen, C clears the sheet.
  handleMouseDown(mx, my, canvasW, canvasH) {
    const [ux, uy] = this.getSheetUV(mx, my, canvasW, canvasH);
    this.cluster(ux, uy);
    this.splash(ux, uy);
    if (this.time - this.lastRingClick > RING_CLICK_GAP) {
      this.lastRingClick = this.time;
      this.addRing((ux - 0.5) * (this.glCanvas.width / this.glCanvas.height), uy - 0.5);
    }
  }

  handleKey(key) {
    if (key === 'c' || key === 'C') this._pendingClear = true;
  }

  dispose() {
    this.accumA = null;
    this.accumB = null;
    this.bakeShader = null;
    this.liftShader = null;
    this.mainShader = null;
    super.dispose();
  }
}

registerModule('InkDrops', InkDropsModule);
