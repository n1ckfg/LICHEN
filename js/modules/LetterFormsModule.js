import { Module } from './Module.js';
import { letterformsFrag } from '../shaders/letterforms.js';
import { LETTERS, letterSegments } from './letterforms/alphabet.js';
import { registerModule } from '../moduleRegistry.js';

const MAX_DT = 0.1;          // clamp long stalls so a tab switch doesn't jump the odometer
const CANVAS = 500;          // the sketch's canvas, w and h
const MAX_STROKE = 20;       // the sketch's maxStroke, which sets the grid's margin
const PHASE_EPSILON = 1e-6;  // see process()

// The sketch's parameter space, in the order its odometer turns. Each step
// adds one step to the first wheel, and a wheel that runs out of its range
// goes back to its min and carries one step into the next.
const ODOMETER = ['stroke', 'columns', 'invert'];

// Every letter's segment table, built once
const SEGMENTS = LETTERS.map(letterSegments);

export class LetterFormsModule extends Module {
  static uid = '65933a93';

  constructor(glCanvas, id) {
    super('LetterForms', glCanvas, id);
    this.inputs = [];
    this.outputs = [{ id: 'df86', name: 'out', type: 'video' }];
    // Letter picks the capital, A–Z, and starts on the sketch's M. Stroke,
    // Columns and Invert default to the sketch's declared values, and their
    // ranges are its parameter space. Rate is the odometer's steps per second:
    // the sketch takes one a frame, at Processing's 60 fps.
    this.params = {
      letter: { id: '3d75', value: LETTERS.indexOf('M'), min: 0, max: LETTERS.length - 1, step: 1, label: 'Letter', valueLabels: LETTERS },
      stroke: { id: '1670', value: 5, min: 1, max: MAX_STROKE, step: 1, label: 'Stroke' },
      columns: { id: 'bbdf', value: 10, min: 1, max: 20, step: 1, label: 'Columns' },
      invert: { id: 'ba99', value: 0, min: 0, max: 1, step: 1, label: 'Invert' },
      rate: { id: 'a3ff', value: 60, min: 0, max: 60, step: 1, label: 'Rate' },
    };

    this.createShader(letterformsFrag);
    this.createOutputFBO();

    // Accumulated, so turning Rate changes the pace without skipping steps
    this.phase = 0;
    this.lastTime = performance.now() / 1000;
  }

  // One turn of the sketch's Params.animate()
  _advance() {
    for (const name of ODOMETER) {
      const p = this.params[name];
      const next = p.value + p.step;
      if (next >= p.min && next <= p.max) {
        this.setParam(name, next);
        return;
      }
      this.setParam(name, p.min);
    }
  }

  process(graph, glCanvas) {
    const now = performance.now() / 1000;
    const dt = Math.min(now - this.lastTime, MAX_DT);
    this.lastTime = now;

    // The tolerance absorbs float rounding in dt × rate, which otherwise makes
    // Rate 60 at 60 fps miss a step one frame and take two the next
    const rate = this.params.rate.value;
    if (rate > 0) {
      this.phase += dt * rate;
      while (this.phase >= 1 - PHASE_EPSILON) {
        this._advance();
        this.phase -= 1;
      }
    }

    // The sketch's grid. Columns is used as a float, as the sketch does, so a
    // cable can zoom it smoothly: the tile shrinks continuously and a new
    // column appears once it fits. Below Columns 1 the sketch would draw no
    // rows at all; this still draws one.
    const columns = Math.max(this.params.columns.value, 0.01);
    const d = (CANVAS - MAX_STROKE) / columns;
    const rows = Math.max(1, Math.floor((CANVAS - MAX_STROKE) / d));
    const tx = MAX_STROKE / 2;
    const ty = (CANVAS - d * rows) / 2;

    // Fit the canvas inside the output, centred
    const w = glCanvas.width;
    const h = glCanvas.height;
    const scale = Math.min(w, h) / CANVAS;

    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('uFrame', [w / scale, h / scale]);
    this.shader.setUniform('uOrigin', [tx, ty]);
    this.shader.setUniform('uGrid', [Math.ceil(columns), rows]);
    this.shader.setUniform('uTile', d);
    this.shader.setUniform('uHalfStroke', Math.max(this.params.stroke.value, 0) / 2);
    this.shader.setUniform('uPixel', 1 / (scale * this.pixelDensity));
    this.shader.setUniform('uInvert', this.params.invert.value);
    // A cable or a typed value can leave Letter between two letters, or past
    // either end
    const letter = Math.max(0, Math.min(LETTERS.length - 1, Math.round(this.params.letter.value)));
    this.shader.setUniform('uSegments', SEGMENTS[letter].segments);
    this.shader.setUniform('uSegmentCount', SEGMENTS[letter].count);
    this.renderQuad();
    this.outputFBO.end();
  }
}

registerModule('LetterForms', LetterFormsModule);
