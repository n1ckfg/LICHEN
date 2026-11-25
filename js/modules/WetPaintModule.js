import { Module } from './Module.js';
import { vertSrc } from '../shaders/vert.js';
import {
  wetPaintBrushFrag, wetPaintSmearFrag, wetPaintShowFrag, wetPaintPickFrag,
  WET_PAINT_SEGMENTS, WET_PAINT_PICK_SCALE,
} from '../shaders/wet-paint.js';
import { WetPaintPanel } from './wetpaint/panel.js';
import { PixelReadback } from './slowscanjam/PixelReadback.js';
import { XYPen, UP } from './latk/strokes.js';
import { letterbox } from '../frame.js';
import { registerModule } from '../moduleRegistry.js';

// The sketch's inks, as pigment absorption per channel
const INKS = [
  { name: 'Sumi', abs: [0.92, 0.88, 0.82] },
  { name: 'Indigo', abs: [1.00, 0.72, 0.18] },
  { name: 'Vermilion', abs: [0.08, 0.92, 1.00] },
  { name: 'Ochre', abs: [0.14, 0.42, 1.05] },
  { name: 'Viridian', abs: [0.98, 0.22, 0.70] },
];
// The sketch filled its window. Its brush size, how fast a brush runs dry and
// its autopilot's pace are kept at the same share of a frame as of a window
// this wide, in px.
const SKETCH_WIDTH = 1400;
// A mouse paints at the sketch's pressure for a mouse
const MOUSE_PRESSURE = 0.6;
// The sketch's per-frame drying rate at a Drying of 1
const DRY_RATE = 0.01;
// The X and Y pen's spacing, as a share of Size
const PEN_SPACING = 0.35;

// Wet ink on paper that smears, bleeds and drips, from the Ink Smears sketch
// (ink-smears/index.html). Strokes are drawn in fullscreen, with the mouse or
// a pen, or by a pen that the X and Y pins drive; the toolbar in fullscreen
// sets the params, as the dials do.
export class WetPaintModule extends Module {
  static uid = '4a72c5eb';

  constructor(glCanvas, id) {
    super('WetPaint', glCanvas, id);
    // A pen that paints as the mouse does, at X and Y (0..1, Y up), while
    // either is cabled; an unplugged one stays at the centre. A loop on either
    // (Latk's, Yellowtail's) paints its strokes, as the beam traces them.
    this.inputs = [{ id: 'dabd', name: 'x', type: 'control' }, { id: '3f6e', name: 'y', type: 'control' }];
    this.outputs = [{ id: 'ecd7', name: 'out', type: 'video' }];
    this.params = {
      ink: { id: '6e46', value: 0, min: 0, max: INKS.length - 1, step: 1, label: 'Ink', widget: 'dropdown',
             valueLabels: INKS.map(i => i.name), random: true },
      size: { id: '6517', value: 12, min: 2, max: 96, step: 1, label: 'Size', random: [4, 40] },
      gravity: { id: '8fdf', value: 1.3, min: 0, max: 4, step: 0.01, label: 'Gravity', random: [0.3, 2.5] },
      swirl: { id: 'b5e8', value: 0.55, min: 0, max: 2, step: 0.01, label: 'Swirl', random: [0, 1.2] },
      bleed: { id: 'b423', value: 0.2, min: 0, max: 1, step: 0.01, label: 'Bleed', random: [0, 0.6] },
      drying: { id: '074a', value: 0.21, min: 0, max: 1, step: 0.01, label: 'Drying', random: [0.05, 0.6] },
      vortex: { id: 'aadf', value: 0, min: 0, max: 2, step: 0.01, label: 'Vortex' },
      freeze: { id: 'b7cc', value: 0, min: 0, max: 1, step: 1, label: 'Motion', widget: 'dropdown',
                valueLabels: ['Flowing', 'Frozen'] },
      auto: { id: '50a4', value: 0, min: 0, max: 1, step: 1, label: 'Autopilot', widget: 'dropdown',
              valueLabels: ['Off', 'On'] },
      clear: { id: '68fa', value: 0, min: 0, max: 1, step: 1, label: 'Clear', widget: 'trigger' },
      reseed: { id: '6805', value: 0, min: 0, max: 1, step: 1, label: 'Seed', widget: 'trigger' },
    };

    this.brushShader = glCanvas.createShader(vertSrc, wetPaintBrushFrag);
    this.smearShader = glCanvas.createShader(vertSrc, wetPaintSmearFrag);
    this.showShader = glCanvas.createShader(vertSrc, wetPaintShowFrag);
    this.pickShader = glCanvas.createShader(vertSrc, wetPaintPickFrag);

    // The state, ping-ponged: half float where it can be drawn to, as the
    // sketch's, else 8 bits, where ink is capped at 1 as the sketch's fallback was
    this.hasFloat = this._detectFloat(glCanvas);
    this.state = [this._stateFBO(), this._stateFBO()];
    this.createOutputFBO();
    // The pixel under the brush, read back without stalling, for pickup
    this.pickFBO = this.createFramebuffer({ width: 1, height: 1, density: 1 });
    this.readback = new PixelReadback(glCanvas);
    this._reading = false;

    this.w = glCanvas.width;
    this.h = glCanvas.height;

    this.inkIndex = -1;
    this.base = INKS[0].abs.slice();
    this.ink = INKS[0].abs.slice();   // the brush's colour, drifting as it picks up ink
    this.segs = [];                   // this frame's segments, in sim px
    // The mouse and the X and Y pins each paint their own stroke
    this.mouseStroke = null;
    this.cableStroke = null;
    this.waterMode = false;           // the toolbar's Water, for the mouse
    this.xyPen = new XYPen();
    // The sketch's autopilot: a short intro on a new node, then Autopilot's
    this.autoIntro = 4;
    this.autoStroke = null;
    this.autoGap = 30;
    this.startTime = performance.now();
    this._pendingClear = true;

    // Pen pressure, from pointer events, which p5's mouse events don't carry
    this.pressure = MOUSE_PRESSURE;
    this._onPointer = (e) => {
      this.pressure = (e.pointerType === 'mouse' || !e.pressure) ? MOUSE_PRESSURE : e.pressure;
    };
    window.addEventListener('pointerdown', this._onPointer, true);
    window.addEventListener('pointermove', this._onPointer, true);

    this.panel = new WetPaintPanel(this);
    this._frame = 0;
    this._shownAt = -1;
  }

  _detectFloat(glCanvas) {
    const gl = glCanvas.drawingContext;
    const webgl2 = glCanvas._renderer && glCanvas._renderer.webglVersion === 'webgl2';
    if (!(webgl2 && gl && gl.getExtension &&
      (gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float')))) {
      return false;
    }
    try {
      this.createFramebuffer({ width: 1, height: 1, density: 1, format: glCanvas.HALF_FLOAT }).remove();
      return true;
    } catch (e) {
      return false;
    }
  }

  _stateFBO() {
    const g = this.glCanvas;
    return this.createFramebuffer(this.hasFloat ? { channels: g.RGBA, format: g.HALF_FLOAT } : { channels: g.RGBA });
  }

  // ui.js calls this every frame while the node is fullscreen
  showFullscreenUI() {
    this._shownAt = this._frame;
    this.panel.show();
  }

  hideFullscreenUI() {
    this.panel.hide();
    this.mouseStroke = null;
  }

  // The brush's colour on paper, for the toolbar's swatch, as the sketch's
  brushCss() {
    const paper = [241, 233, 218];
    return `rgb(${paper.map((p, i) => Math.round(p * Math.exp(-this.ink[i] * 1.6))).join(',')})`;
  }

  _setInk(i) {
    this.inkIndex = i;
    this.base = INKS[i].abs.slice();
    this.ink = INKS[i].abs.slice();
  }

  // - - - Strokes, in frame px with y down, as the sketch's in CSS px - - -

  _radius(pressure, speed) {
    const size = this.params.size.value;
    const thin = Math.min(1.1, Math.max(0.45, 1.15 - speed / (size * 3)));
    return size * (0.35 + 0.85 * pressure) * thin;
  }

  _beginStroke(x, y, pressure, water) {
    // Re-dipping cleans the brush halfway back toward its base ink
    for (let i = 0; i < 3; i++) this.ink[i] += (this.base[i] - this.ink[i]) * 0.5;
    const r = this._radius(pressure, 0);
    const s = { x, y, r, load: 1, seed: Math.random() * 100, water, moved: true };
    this._pushSeg(s, x, y, r);
    return s;
  }

  _moveStroke(s, x, y, pressure) {
    if (!s) return;
    const nx = s.x + (x - s.x) * 0.6, ny = s.y + (y - s.y) * 0.6;
    const L = Math.hypot(nx - s.x, ny - s.y);
    if (L < 0.5) return;
    const r = s.r + (this._radius(pressure, L) - s.r) * 0.3;
    if (!s.water) s.load = Math.max(0.04, s.load - L * 0.0006 * SKETCH_WIDTH / this.w);
    const from = { x: s.x, y: s.y, r: s.r };
    s.x = nx; s.y = ny; s.r = r;
    this._pushSeg(s, nx, ny, r, from);
    s.moved = true;
  }

  _pushSeg(s, x, y, r, from = { x, y, r }) {
    this.segs.push({ x0: from.x, y0: from.y, x1: x, y1: y, r0: from.r, r1: r, load: s.load, seed: s.seed, water: s.water });
  }

  // - - - Mouse and keys in fullscreen - - -

  framePos(mx, my, canvasW, canvasH) {
    const { dx, dy, dw, dh } = letterbox(this.w, this.h, canvasW, canvasH);
    return [(mx - dx) / dw * this.w, (my - dy) / dh * this.h];
  }

  handleMouseDown(mx, my, canvasW, canvasH, button) {
    const p = this.glCanvas._pInst;
    const shift = p && p.keyIsDown && p.keyIsDown(16);
    this._stopAuto();
    const [x, y] = this.framePos(mx, my, canvasW, canvasH);
    this.mouseStroke = this._beginStroke(x, y, this.pressure, button === 'right' || shift || this.waterMode);
  }

  handleMouseDrag(mx, my, canvasW, canvasH) {
    const [x, y] = this.framePos(mx, my, canvasW, canvasH);
    this._moveStroke(this.mouseStroke, x, y, this.pressure);
  }

  handleMouseUp() {
    this.mouseStroke = null;
  }

  handleWheel(delta) {
    this.setParam('size', this.params.size.value + (delta > 0 ? -1 : 1));
  }

  handleKey(key, keyCode, p) {
    const mod = p && (p.keyIsDown(p.CONTROL) || p.keyIsDown(91) || p.keyIsDown(93));
    const k = key.length === 1 ? key.toLowerCase() : key;
    if (k >= '1' && k <= String(INKS.length)) this.setParam('ink', parseInt(k) - 1);
    else if (k === '[') this.setParam('size', Math.round(this.params.size.value / 1.2));
    else if (k === ']') this.setParam('size', Math.round(this.params.size.value * 1.2));
    else if (k === 'f') this.setParam('vortex', this.params.vortex.value > 0 ? 0 : 1);
    else if (k === 'a') {
      const on = this.params.auto.value < 0.5;
      this._stopAuto();
      this.setParam('auto', on ? 1 : 0);
    }
    else if (k === ' ') this.setParam('freeze', this.params.freeze.value > 0.5 ? 0 : 1);
    else if (k === 'c' && !mod) this.clear();
    else if (k === 's') this.saveImage();
  }

  clear() {
    this._pendingClear = true;
  }

  onTrigger(name) {
    if (name === 'reseed') this.randomize();
    else if (name === 'clear') this.clear();
  }

  triggerText(name) {
    return name === 'reseed' ? this.seed : '';
  }

  // Every buffer came back cleared at the new size, so the sheet starts again;
  // strokes being painted lift
  frameResized(w, h) {
    this.w = w;
    this.h = h;
    this.mouseStroke = this.cableStroke = null;
    this.autoStroke = null;
    this._pendingClear = true;
  }

  // - - - Autopilot, the sketch's: wandering strokes, now and then dwelling to pool - - -

  _stopAuto() {
    this.autoIntro = 0;
    if (this.autoStroke) this.autoStroke = null;
    this.setParam('auto', 0);
  }

  _autoStep() {
    const on = this.params.auto.value > 0.5;
    if (!on && this.autoIntro <= 0) {
      this.autoStroke = null;
      return;
    }
    if (this.autoGap > 0) {
      this.autoGap--;
      return;
    }
    const w = this.w, h = this.h;
    const scale = w / SKETCH_WIDTH;
    let a = this.autoStroke;
    if (!a) {
      if (Math.random() < 0.4) this.setParam('ink', Math.floor(Math.random() * INKS.length));
      this._syncInk();
      a = this.autoStroke = {
        x: w * (0.15 + 0.7 * Math.random()), y: h * (0.15 + 0.55 * Math.random()),
        ang: Math.random() * Math.PI * 2, curve: (Math.random() - 0.5) * 0.09,
        steps: 50 + (Math.random() * 90 | 0), t: 0, dwell: 0, speed: (5 + Math.random() * 9) * scale,
        water: on && Math.random() < 0.12,
      };
      a.stroke = this._beginStroke(a.x, a.y, 0.6, a.water);
    }
    if (a.dwell > 0) a.dwell--;
    else {
      a.ang += a.curve + (Math.random() - 0.5) * 0.12;
      a.x += Math.cos(a.ang) * a.speed;
      a.y += Math.sin(a.ang) * a.speed;
      if (a.x < w * 0.08 || a.x > w * 0.92) a.ang = Math.PI - a.ang;
      if (a.y < h * 0.08 || a.y > h * 0.85) a.ang = -a.ang;
      this._moveStroke(a.stroke, a.x, a.y, 0.55 + 0.4 * Math.sin(a.t * 0.07));
      if (Math.random() < 0.015) a.dwell = 25 + (Math.random() * 45 | 0);
    }
    if (++a.t > a.steps) {
      this.autoStroke = null;
      this.autoGap = 10 + (Math.random() * 40 | 0);
      if (!on) this.autoIntro--;
    }
  }

  // - - - The X and Y pen (see XYPen in latk/strokes.js) - - -

  // A loop's beam moves under a pixel a sample, and every segment over a pixel
  // lays ink down in the same pass, so moves are kept about half the brush's
  // radius apart, as a mouse's events come in the sketch at a steady drag
  _penFromInputs(graph) {
    const minStep = Math.max(1, this.params.size.value * PEN_SPACING);
    const moves = this.xyPen.trace(this, graph, this.w, this.h, minStep) ?? [UP];
    for (const m of moves) {
      if (m === UP) this.cableStroke = null;
      else if (!this.cableStroke) this.cableStroke = this._beginStroke(m.x, m.y, MOUSE_PRESSURE, false);
      else this._moveStroke(this.cableStroke, m.x, m.y, MOUSE_PRESSURE);
    }
  }

  // - - - Passes - - -

  _syncInk() {
    const i = Math.max(0, Math.min(INKS.length - 1, Math.round(this.params.ink.value)));
    if (i !== this.inkIndex) this._setInk(i);
  }

  _strokes() {
    return [this.mouseStroke, this.cableStroke, this.autoStroke && this.autoStroke.stroke].filter(Boolean);
  }

  // One pass of the state into the other buffer, which then becomes the state
  _pass(shader, setup) {
    const g = this.glCanvas;
    const [read, write] = this.state;
    write.begin();
    g.shader(shader);
    shader.setUniform('uState', read);
    shader.setUniform('uRes', this.fragResolution());
    setup(shader);
    this.renderQuad();
    write.end();
    this.state = [write, read];
  }

  _brushPasses(list, water) {
    const d = this.pixelDensity;
    const H = this.h;
    const seg = new Float32Array(WET_PAINT_SEGMENTS * 4), aux = new Float32Array(WET_PAINT_SEGMENTS * 4);
    for (let off = 0; off < list.length; off += WET_PAINT_SEGMENTS) {
      const n = Math.min(WET_PAINT_SEGMENTS, list.length - off);
      seg.fill(0);
      aux.fill(0);
      for (let i = 0; i < n; i++) {
        const s = list[off + i];
        // Frame px, y down, to sim px, y up
        seg.set([s.x0 * d, (H - s.y0) * d, s.x1 * d, (H - s.y1) * d], i * 4);
        aux.set([s.r0 * d, s.r1 * d, s.load, s.seed], i * 4);
      }
      this._pass(this.brushShader, (sh) => {
        sh.setUniform('uCount', n);
        sh.setUniform('uSeg', Array.from(seg));
        sh.setUniform('uAux', Array.from(aux));
        sh.setUniform('uInk', this.ink);
        sh.setUniform('uWater', water ? 1 : 0);
      });
    }
  }

  // The brush absorbs pigment it passes over, so its colour drifts toward
  // what is already on the page. The pixel comes back a frame or so later.
  _pickup(g) {
    if (this._reading) {
      const px = this.readback.poll();
      if (px === null) return;
      this._reading = false;
      if (px) this._pickUp(px);
    }
    const s = this._strokes().find(st => !st.water);
    if (!s) return;
    this.pickFBO.begin();
    g.shader(this.pickShader);
    this.pickShader.setUniform('uState', this.state[0]);
    this.pickShader.setUniform('uPos', [s.x / this.w, 1 - s.y / this.h]);
    this.renderQuad();
    this.pickFBO.end();
    // WebGL1 has no fenced reads, and gives the pixel at once
    const now = this.readback.start(this.pickFBO, 1, 1);
    if (now) this._pickUp(now);
    else this._reading = true;
  }

  // The sketch's pickup from one pixel of the state, scaled back from 8 bits
  _pickUp(px) {
    const p = [0, 1, 2].map(i => px[i] / 255 * WET_PAINT_PICK_SCALE);
    const m = Math.max(...p);
    if (m < 0.05) return;
    const k = 0.03 * Math.min(m, 1.2);
    for (let i = 0; i < 3; i++) this.ink[i] += (p[i] / m - this.ink[i]) * k;
  }

  process(graph, glCanvas) {
    const g = glCanvas;
    this._frame++;
    // Leaving fullscreen any way but ESC (a patch loaded over it, say) still hides the toolbar
    if (this.panel.visible && this._shownAt < this._frame - 1) this.hideFullscreenUI();

    g.blendMode(g.REPLACE);
    if (this._pendingClear) {
      this._pendingClear = false;
      for (const fbo of this.state) {
        fbo.begin();
        g.clear();
        fbo.end();
      }
    }

    this._syncInk();
    this._autoStep();
    this._penFromInputs(graph);

    // A brush held still keeps laying down ink, so it pools, and pools drip
    for (const s of this._strokes()) {
      if (!s.moved) this._pushSeg(s, s.x, s.y, s.r);
      s.moved = false;
    }
    if (this.segs.length) {
      this._brushPasses(this.segs.filter(s => !s.water), false);
      this._brushPasses(this.segs.filter(s => s.water), true);
      this.segs = [];
    }

    if (this.params.freeze.value < 0.5) {
      const [W, H] = this.fragResolution();
      this._pass(this.smearShader, (sh) => {
        sh.setUniform('uTexel', [1 / W, 1 / H]);
        sh.setUniform('uTime', (performance.now() - this.startTime) / 1000);
        sh.setUniform('uGravity', this.params.gravity.value * this.pixelDensity);
        sh.setUniform('uSwirl', this.params.swirl.value);
        sh.setUniform('uBleed', this.params.bleed.value);
        sh.setUniform('uDry', this.params.drying.value * DRY_RATE);
        sh.setUniform('uVortex', this.params.vortex.value);
        sh.setUniform('uAspect', W / H);
      });
    }

    this._pickup(g);

    const [W, H] = this.fragResolution();
    this.outputFBO.begin();
    g.shader(this.showShader);
    this.showShader.setUniform('uState', this.state[0]);
    this.showShader.setUniform('uRes', [W, H]);
    this.showShader.setUniform('uTexel', [1 / W, 1 / H]);
    this.renderQuad();
    this.outputFBO.end();
    g.blendMode(g.BLEND);
  }

  // The picture as a PNG, at the framebuffer's full size
  saveImage() {
    const fbo = this.outputFBO;
    fbo.loadPixels();
    const w = Math.round(fbo.width * fbo.density), h = Math.round(fbo.height * fbo.density);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Row 0 is already the top of the picture as the UI shows it
    ctx.putImageData(new ImageData(new Uint8ClampedArray(fbo.pixels), w, h), 0, 0);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `wet-paint-${stamp}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, 'image/png');
  }

  dispose() {
    window.removeEventListener('pointerdown', this._onPointer, true);
    window.removeEventListener('pointermove', this._onPointer, true);
    this.panel.dispose();
    this.readback.dispose();
    for (const fbo of [...this.state, this.pickFBO]) fbo.remove();
    this.state = [];
    this.pickFBO = null;
    this.brushShader = this.smearShader = this.showShader = this.pickShader = null;
    super.dispose();
  }
}

registerModule('WetPaint', WetPaintModule);
