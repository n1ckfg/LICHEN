import { Module } from './Module.js';
import { passthroughFrag } from '../shaders/passthrough.js';
import { registerModule } from '../moduleRegistry.js';
import { letterbox } from '../frame.js';
import { polylinePieces, XYOutputs } from './latk/strokes.js';
import './naplps/naplps.js';     // UMD script: puts NAPLPS on window
import './naplps/TelidonP5.js';  // UMD script: puts TelidonP5 on window

const { NAPLPS, TelidonP5 } = window;

const SAMPLE_RATE = 44100;   // of the X and Y outputs, as Latk's
const MAX_DT = 0.1;          // clamp long stalls so a tab switch doesn't jump the beam
const CMDS_PER_SECOND = 150; // playback speed at Speed = 1, as Telidon's NapPlayer
const CIRCLE_SEGMENTS = 72;  // a 2-point circle's sides on X and Y
const ARC_SEGMENTS = 64;     // a 3-point arc's sides on X and Y
const SPLINE_STEPS = 16;     // samples per Catmull-Rom span on X and Y

const WHITE = { r: 1, g: 1, b: 1 };

function chan(v) {
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}

function normalizeAngle(a) {
  const t = a % (Math.PI * 2);
  return t < 0 ? t + Math.PI * 2 : t;
}

// Sample the circular arc starting at a, passing through b, ending at c
// (matching TelidonP5's arcPoints).
function sampleArc(a, b, c, steps = ARC_SEGMENTS) {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-9) return [a, c];
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  const cx = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const cy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  const r = Math.hypot(a.x - cx, a.y - cy);
  const start = Math.atan2(a.y - cy, a.x - cx);
  const mid = Math.atan2(b.y - cy, b.x - cx);
  const end = Math.atan2(c.y - cy, c.x - cx);
  const ccw = normalizeAngle(mid - start) < normalizeAngle(end - start);
  const sweep = ccw ? normalizeAngle(end - start) : -normalizeAngle(start - end);
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = start + sweep * (i / steps);
    out.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
  }
  return out;
}

// Catmull-Rom spline through pts (matching TelidonP5's splinePoints).
function sampleSpline(pts, steps = SPLINE_STEPS) {
  const out = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i > 0 ? i - 1 : 0];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2 < pts.length ? i + 2 : pts.length - 1];
    for (let s = 1; s <= steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      out.push({
        x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t +
          (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
          (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  return out;
}

function blinkIsOn(b, time) {
  const period = b.on + b.off;
  if (period <= 0) return false;
  let phase = (time - b.start) % period;
  if (phase < 0) phase += period;
  return phase < b.on;
}

function registerBlink(blinks, cmd, clock) {
  let existing = -1;
  for (let i = 0; i < blinks.length; i++) {
    if (blinks[i].from === cmd.from && (cmd.to === undefined || blinks[i].to === cmd.to)) {
      existing = i;
      break;
    }
  }
  if (cmd.stop) {
    if (cmd.to === undefined) {
      for (let i = blinks.length - 1; i >= 0; i--) {
        if (blinks[i].from === cmd.from) blinks.splice(i, 1);
      }
    } else if (existing >= 0) {
      blinks.splice(existing, 1);
    }
    return;
  }
  const last = blinks[blinks.length - 1];
  const start = last ? last.start + (cmd.delay || 0) : clock;
  const proc = { from: cmd.from, to: cmd.to, on: cmd.on, off: cmd.off, start };
  if (existing >= 0) blinks[existing] = proc;
  else blinks.push(proc);
}

// Plays back a NAPLPS / Telidon 699 (.nap) file through naplps.js and
// TelidonP5.js, advancing through its command array with WAIT pauses and BLINK
// palette animation. Its X and Y outputs carry what is drawn as one loop of XY
// audio, as Latk's do, to drive Twoscilloscope.
export class NAPLPSModule extends Module {
  static uid = '3fd67525';

  constructor(glCanvas, id) {
    super('NAPLPS', glCanvas, id);
    this.outputs = [
      { id: '5a97', name: 'out', type: 'video' },
      { id: 'c7e5', name: 'x', type: 'control' },
      { id: '4e53', name: 'y', type: 'control' },
    ];
    this.historicalInfo = 'NAPLPS';
    this.params = {
      speed: { id: '9a2d', value: 1, min: 0.1, max: 10, step: 0.1, label: 'Speed' },
      // Loops a second on X and Y. A lower rate gives the drawing more samples
      loopHz: { id: '48f2', value: 5, min: 1, max: 100, step: 0.1, label: 'Loop Hz' },
    };
    this.commands = [];
    this.blinks = false;
    this.index = 0;      // commands revealed so far
    this.spent = 0;      // seconds of playback spent
    this.clock = 0;      // seconds spent inside WAIT commands
    this.elapsed = 0;    // total scaled playback seconds
    this.blinkTime = 0;  // seconds for palette blink phase
    this.finished = false;
    this.dirty = false;
    this.pieces = [];
    this.pg = null;
    this.napPg = null;   // 4:3 render target used when the frame is not 4:3
    this.napReady = false;
    this.xy = new XYOutputs(SAMPLE_RATE);
    this.lastTime = performance.now() / 1000;
    this.createShader(passthroughFrag);
    this.createOutputFBO();
    this._createFileInput();
  }

  _createFileInput() {
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.nap,.NAP';
    this.fileInput.style.display = 'none';
    document.body.appendChild(this.fileInput);
    this.fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) this.loadNAPFile(file);
      this.fileInput.value = '';
    });
  }

  pickFile() {
    this.fileInput.click();
  }

  loadNAPFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      this.loadNAPData(new Uint8Array(e.target.result));
    };
    // NAPLPS is a byte stream; reading as text would corrupt bytes >= 0x80
    reader.readAsArrayBuffer(file);
  }

  loadNAPData(data) {
    let decoded;
    try {
      decoded = NAPLPS.decode(data);
    } catch (err) {
      console.error("Couldn't decode NAPLPS input", err);
      return;
    }

    this._freeMaskSheets();
    const p = this.glCanvas._pInst;
    const w = this.glCanvas.width;
    const h = this.glCanvas.height;

    if (!this.pg) {
      this.pg = p.createGraphics(w, h);
    } else if (this.pg.width !== w || this.pg.height !== h) {
      this.pg.resizeCanvas(w, h, true);
    }

    this.commands = decoded.commands;
    this.blinks = TelidonP5.hasBlink(this.commands);
    this.index = 0;
    this.spent = 0;
    this.clock = 0;
    this.elapsed = 0;
    this.blinkTime = 0;
    this.finished = false;
    this.pieces = [];
    this.dirty = true;
    this.napReady = true;
  }

  _freeMaskSheets() {
    for (const cmd of this.commands) {
      if (cmd.p5Sheet) {
        cmd.p5Sheet.remove();
        cmd.p5Sheet = null;
        cmd.p5Key = null;
      }
    }
  }

  _advance() {
    let moved = false;
    while (this.index < this.commands.length) {
      const cmd = this.commands[this.index];
      const cost = cmd.type === 'wait' ? (cmd.seconds || 0) : 1 / CMDS_PER_SECOND;
      if (this.spent + cost > this.elapsed) break;
      this.spent += cost;
      if (cmd.type === 'wait') this.clock += cmd.seconds || 0;
      this.index++;
      moved = true;
    }
    if (this.index >= this.commands.length) this.finished = true;
    return moved;
  }

  _renderToGraphics(w, h) {
    const opts = {
      limit: this.index,
      time: this.clock,
      blinkTime: this.blinkTime,
    };

    if (w * 3 === h * 4) {
      if (this.napPg) {
        this.napPg.remove();
        this.napPg = null;
      }
      TelidonP5.render(this.pg, this.commands, opts);
      return;
    }

    // Non-4:3 frame: render into a 4:3 buffer so TelidonP5 preserves aspect
    // ratio without cropping, then letterbox onto pg
    const box = letterbox(4, 3, w, h);
    const rw = Math.max(1, Math.round(box.dw));
    const rh = Math.max(1, Math.round(box.dh));
    const p = this.glCanvas._pInst;
    if (!this.napPg) {
      this.napPg = p.createGraphics(rw, rh);
    } else if (this.napPg.width !== rw || this.napPg.height !== rh) {
      this.napPg.resizeCanvas(rw, rh, true);
    }
    TelidonP5.render(this.napPg, this.commands, opts);
    this.pg.background(0);
    this.pg.imageMode(this.pg.CORNER);
    this.pg.image(this.napPg, box.dx, box.dy, box.dw, box.dh);
  }

  process(graph, glCanvas) {
    const now = performance.now() / 1000;
    const dt = Math.min(Math.max(now - this.lastTime, 0), MAX_DT);
    this.lastTime = now;

    const w = glCanvas.width;
    const h = glCanvas.height;

    if (this.napReady && this.pg) {
      const speed = Math.max(0, this.params.speed.value);
      this.elapsed += dt * speed;
      this.blinkTime += dt * speed;

      const moved = this._advance();
      if (moved || this.blinks || this.dirty) {
        this._renderToGraphics(w, h);
        this.pieces = this._extractPieces(w, h);
        this.dirty = false;

        this.outputFBO.begin();
        glCanvas.clear();
        glCanvas.shader(this.shader);
        this.shader.setUniform('tex0', this.pg);
        this.renderQuad();
        this.outputFBO.end();
      }
    }

    // What was drawn as one loop of XY audio on the X and Y outputs. Before a
    // file is in, the loop is all blank, so the beam rests unlit in the middle.
    this.xy.publish(this, this.pieces, w, h, dt, this.params.loopHz.value);
  }

  // Walks the decoded commands rendered in this frame and returns their vector
  // outlines as pieces for the X and Y outputs (see latk/strokes.js). Filled
  // shapes are traced as outlines; text, mosaics, DRCS and single points are
  // left out.
  _extractPieces(w, h) {
    let vp;
    if (w * 3 === h * 4) {
      vp = new TelidonP5.Viewport(w, h);
    } else {
      const box = letterbox(4, 3, w, h);
      vp = new TelidonP5.Viewport(box.dw, box.dh, {
        originX: box.dx,
        originY: box.dy + box.dh,
      });
    }

    const limit = Math.min(this.index, this.commands.length);
    const time = this.clock;
    const blinkTime = this.blinkTime;

    // Pre-pass for the display palette at the end of this frame (as TelidonP5
    // does, since rewriting a palette entry recolors shapes already drawn in it).
    let displayPalette = [];
    {
      let clock = 0;
      for (let i = 0; i < limit; i++) {
        const cmd = this.commands[i];
        if (cmd.type === 'wait') {
          clock += cmd.seconds || 0;
          if (clock > time) break;
          continue;
        }
        if (cmd.type === 'palette') {
          displayPalette = cmd.colors.map((c) => ({ r: c.r, g: c.g, b: c.b }));
        } else if (cmd.type === 'setPalette') {
          displayPalette[cmd.index] = { r: cmd.r, g: cmd.g, b: cmd.b };
        }
      }
    }

    let colorMode = 0;
    let direct = WHITE;
    let fgIndex = 0;
    const blinks = [];
    const pieces = [];

    const currentRgb = () => {
      let c;
      if (colorMode === 0) {
        c = direct;
      } else {
        let idx = fgIndex;
        for (let i = 0; i < blinks.length; i++) {
          const b = blinks[i];
          if (b.from === idx && blinkIsOn(b, blinkTime)) idx = b.to;
        }
        c = displayPalette[idx] || WHITE;
      }
      return [chan(c.r), chan(c.g), chan(c.b)];
    };

    const outline = (pts, rgb) => {
      for (const piece of polylinePieces(pts, rgb, w, h)) pieces.push(piece);
    };

    let clock = 0;
    for (let i = 0; i < limit; i++) {
      const cmd = this.commands[i];
      if (cmd.type === 'wait') {
        clock += cmd.seconds || 0;
        if (clock > time) break;
        continue;
      }

      switch (cmd.type) {
        case 'reset':
          if (cmd.screen) pieces.length = 0;
          break;

        case 'setColor':
          if (!cmd.transparent) direct = { r: cmd.r, g: cmd.g, b: cmd.b };
          break;

        case 'selectColor':
          if (cmd.mode !== undefined) colorMode = cmd.mode;
          if (cmd.index !== undefined) fgIndex = cmd.index;
          break;

        case 'blink':
          registerBlink(blinks, cmd, clock);
          break;

        case 'blinkReset':
          blinks.length = 0;
          break;

        case 'line': {
          const rgb = currentRgb();
          outline([
            { x: vp.x(cmd.x1), y: vp.y(cmd.y1) },
            { x: vp.x(cmd.x2), y: vp.y(cmd.y2) },
          ], rgb);
          break;
        }

        case 'rect': {
          const rgb = currentRgb();
          const x0 = vp.x(Math.min(cmd.x, cmd.x + cmd.w));
          const x1 = vp.x(Math.max(cmd.x, cmd.x + cmd.w));
          const y0 = vp.y(Math.max(cmd.y, cmd.y + cmd.h));
          const y1 = vp.y(Math.min(cmd.y, cmd.y + cmd.h));
          outline([
            { x: x0, y: y0 },
            { x: x1, y: y0 },
            { x: x1, y: y1 },
            { x: x0, y: y1 },
            { x: x0, y: y0 },
          ], rgb);
          break;
        }

        case 'polygon': {
          if (!cmd.points || cmd.points.length < 2) break;
          const rgb = currentRgb();
          const pts = cmd.points.map((pt) => ({ x: vp.x(pt.x), y: vp.y(pt.y) }));
          pts.push(pts[0]);
          outline(pts, rgb);
          break;
        }

        case 'arc': {
          if (!cmd.points || cmd.points.length < 2) break;
          const rgb = currentRgb();
          const pts = cmd.points.map((pt) => ({ x: vp.x(pt.x), y: vp.y(pt.y) }));
          let curve;
          if (pts.length === 2) {
            const a = pts[0], b = pts[1];
            const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
            const r = Math.hypot(b.x - a.x, b.y - a.y) / 2;
            curve = [];
            for (let k = 0; k <= CIRCLE_SEGMENTS; k++) {
              const t = (k / CIRCLE_SEGMENTS) * Math.PI * 2;
              curve.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
            }
          } else if (pts.length === 3) {
            curve = sampleArc(pts[0], pts[1], pts[2]);
          } else {
            curve = sampleSpline(pts);
          }
          outline(curve, rgb);
          break;
        }

        case 'incLine': {
          if (!cmd.segments || cmd.segments.length === 0) break;
          const rgb = currentRgb();
          let run = null;
          let lastX = 0, lastY = 0;
          for (const s of cmd.segments) {
            const x1 = vp.x(s.x1), y1 = vp.y(s.y1);
            const x2 = vp.x(s.x2), y2 = vp.y(s.y2);
            if (run && Math.abs(x1 - lastX) < 1e-6 && Math.abs(y1 - lastY) < 1e-6) {
              run.push({ x: x2, y: y2 });
            } else {
              if (run) outline(run, rgb);
              run = [{ x: x1, y: y1 }, { x: x2, y: y2 }];
            }
            lastX = x2;
            lastY = y2;
          }
          if (run) outline(run, rgb);
          break;
        }

        default:
          break;
      }
    }

    return pieces;
  }

  // The commands are drawn again into a buffer of the new frame size
  frameResized(w, h) {
    if (this.pg) this.pg.resizeCanvas(w, h, true);
    if (this.napReady) this.dirty = true;
  }

  dispose() {
    this._freeMaskSheets();
    if (this.napPg) this.napPg.remove();
    if (this.pg) this.pg.remove();
    if (this.fileInput) this.fileInput.remove();
    super.dispose();
  }
}

registerModule('NAPLPS', NAPLPSModule);
