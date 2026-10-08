import { Module } from './Module.js';
import { whitneyVert, whitneyFrag } from '../shaders/whitney.js';
import { registerModule } from '../moduleRegistry.js';

const TAU = Math.PI * 2;
const MAX_DT = 0.1;     // clamp long stalls so a tab switch doesn't jump the clock
const MAX_DOTS = 400;
const MUSIC_BOX_DOTS = 48;

// WhitneyScope's cycleLength (not classicStyle) and its timer speed
const SCOPE_CYCLE = 2000 * 15 * 60;
const SCOPE_SPEED = (TAU * 400) / SCOPE_CYCLE;
const SCOPE_MOUSE_Y = 0.1;  // mouseY / height at Offset 0
// Arabesque's wrap width, 3 * radius, and Math.round() of it
const ARABESQUE_R = 3 * 211.2;
const ARABESQUE_RR = 634;

// The five sketches from Whitney-Music-Box-Examples/processing_selects, in drop-down
// order. Patches save the sketch as its index, so append, never insert.
// design: the sketch's size(). cycle: the seconds of its clock that Offset 0..1
// spans. fps: its frameRate(), or 0 for Processing's default, every frame.
const SKETCHES = [
  { label: 'Music Box', count: MUSIC_BOX_DOTS, design: [500, 500], cycle: 30, fps: 0 },
  { label: 'WhitneyScope', count: 400, design: [600, 600], cycle: SCOPE_CYCLE, fps: 0 },
  { label: 'Arabesque', count: 360, design: [640, 480], cycle: 600, fps: 24 },
  { label: 'Column A', count: 60, design: [280, 192], cycle: 60, fps: 10 },
  { label: 'Column BC', count: 360, design: [500, 500], cycle: 600, fps: 24 },
];

const fract = (x) => x - Math.floor(x);

let nextGeometryId = 0;

export class WhitneyModule extends Module {
  static uid = '4bde3bfa';

  constructor(glCanvas, id) {
    super('Whitney', glCanvas, id);
    this.inputs = [];
    this.outputs = [{ id: '9670', name: 'out', type: 'video' }];
    this.historicalInfo = 'Whitney';
    this.params = {
      sketch: {
        id: '0320', value: 0, min: 0, max: SKETCHES.length - 1, step: 1, label: 'Sketch', widget: 'dropdown',
        valueLabels: SKETCHES.map(s => s.label),
      },
      speed: { id: '5533', value: 1, min: -8, max: 8, step: 0.01, label: 'Speed' },
      offset: { id: '38e5', value: 0, min: 0, max: 1, step: 0.001, label: 'Offset' },
      size: { id: '1329', value: 1, min: 0.25, max: 4, step: 0.01, label: 'Size' },
    };

    this.dotShader = glCanvas.createShader(whitneyVert, whitneyFrag);
    this.createOutputFBO();
    this.geometry = this._buildGeometry();

    this.since = new Array(MUSIC_BOX_DOTS).fill(0);
    this.lastTime = performance.now() / 1000;
    this.index = -1;
    this.lastKey = null;
  }

  // One quad per dot, plus quad 0 for the Music Box's line. The vertex shader
  // places every quad, so this is built once and never re-uploaded.
  _buildGeometry() {
    const geometry = new p5.Geometry(1, 1, function () {
      for (let q = 0; q <= MAX_DOTS; q++) {
        const base = this.vertices.length;
        this.vertices.push(
          new p5.Vector(-1, -1, q), new p5.Vector(1, -1, q),
          new p5.Vector(1, 1, q), new p5.Vector(-1, 1, q));
        this.faces.push([base, base + 1, base + 2], [base, base + 2, base + 3]);
      }
    });
    // p5 caches a geometry's GPU buffers under its gid, and a hand-built one has
    // none: without its own, it would share (and draw) another geometry's buffers.
    geometry.gid = `Whitney|${nextGeometryId++}`;
    return geometry;
  }

  // Choosing a sketch restarts its clock, as launching the original would
  _restart(index) {
    this.index = index;
    this.time = 0;
    this.frame = null;
    this.revs = new Array(MUSIC_BOX_DOTS).fill(NaN);
    this.hits = new Array(MUSIC_BOX_DOTS).fill(0);
  }

  // The per-sketch clock the vertex shader reads as uState, reduced in double
  // precision to the cycle fractions it needs. See js/shaders/whitney.js.
  _state(index, t, now) {
    switch (index) {
      case 0: {
        // Dot i turns i + 1 times per cycle. As in the original, it sounds (here,
        // flashes) whenever its count of whole turns changes, whichever way it moves.
        const turns = t / SKETCHES[0].cycle;
        for (let i = 0; i < MUSIC_BOX_DOTS; i++) {
          const rev = Math.floor(turns * (i + 1));
          if (rev !== this.revs[i]) {
            this.revs[i] = rev;
            this.hits[i] = now;
          }
          // The flash is over by 500 ms, so holding there keeps idle frames identical
          this.since[i] = Math.min(500, (now - this.hits[i]) * 1000);
        }
        return [fract(turns), 0, 0, 0];
      }
      case 1: {
        const timer = t * SCOPE_SPEED;
        const flip = (Math.floor(timer / SCOPE_CYCLE) & 1) === 0 ? 1 : 0;
        return [fract(timer / (TAU * 400)), fract(timer * timer / (TAU * 400)), fract(timer * 0.01), flip];
      }
      case 2: {
        const wrap = (t / 600) * ARABESQUE_R;
        return [((wrap % ARABESQUE_RR) + ARABESQUE_RR) % ARABESQUE_RR, 0, 0, 0];
      }
      case 3:
        return [170 * fract(t / 60), 0, 0, 0];
      default:
        return [fract(t / 600), 0, 0, 0];
    }
  }

  process(graph, glCanvas) {
    const now = performance.now() / 1000;
    const dt = Math.min(Math.max(now - this.lastTime, 0), MAX_DT);
    this.lastTime = now;

    // Rounded, like the dropdown's label, so a control cable can't land between sketches
    const index = Math.min(SKETCHES.length - 1, Math.max(0, Math.round(this.params.sketch.value)));
    if (index !== this.index) this._restart(index);
    const sketch = SKETCHES[index];

    // Accumulated, so turning Speed doesn't jump the animation
    this.time += dt * this.params.speed.value;

    // The original's frameRate(): each frame shows the clock as it stood when the
    // frame began, and holds for 1 / fps
    if (sketch.fps) {
      const frame = Math.floor(now * sketch.fps);
      if (frame !== this.frame) {
        this.frame = frame;
        this.heldTime = this.time;
      }
    } else {
      this.heldTime = this.time;
    }

    // Offset moves the start through the cycle. WhitneyScope's stands in for its
    // mouse height (startTime = -cycleLength * mouseY / height), which sets every
    // dot's angle, plus a tenth: at the top the original sits collapsed on the
    // centre for minutes, and a tenth of the way down its dots form a ten-armed star.
    const offset = this.params.offset.value + (index === 1 ? SCOPE_MOUSE_Y : 0);
    const state = this._state(index, this.heldTime + offset * sketch.cycle, now);

    // Fit the sketch's canvas inside the output, centred
    const w = glCanvas.width;
    const h = glCanvas.height;
    const [dw, dh] = sketch.design;
    const fit = Math.min(w / dw, h / dh);
    const density = this.pixelDensity;
    const size = this.params.size.value;

    // Nothing to redraw while the frame is held, or the clock is stopped
    const key = `${index} ${state.join(' ')} ${size} ${w} ${h} ${density}` +
      (index === 0 ? ` ${this.since.join(' ')}` : '');
    if (key === this.lastKey) return;
    this.lastKey = key;

    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.background(0);
    glCanvas.blendMode(glCanvas.BLEND);
    glCanvas.noStroke();
    glCanvas.fill(255);
    glCanvas.shader(this.dotShader);
    this.dotShader.setUniform('uMode', index);
    this.dotShader.setUniform('uCount', sketch.count);
    this.dotShader.setUniform('uState', state);
    this.dotShader.setUniform('uSince', this.since);
    this.dotShader.setUniform('uScale', [2 * fit / w, 2 * fit / h]);
    this.dotShader.setUniform('uBias', [-dw * fit / w, -dh * fit / h]);
    this.dotShader.setUniform('uPxPerUnit', fit * density);
    this.dotShader.setUniform('uSize', size);
    glCanvas.model(this.geometry);
    this.outputFBO.end();
  }

  dispose() {
    if (this.geometry) this.glCanvas.freeGeometry(this.geometry);
    this.geometry = null;
    this.dotShader = null;
    super.dispose();
  }
}

registerModule('Whitney', WhitneyModule);
