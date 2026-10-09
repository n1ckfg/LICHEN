import { Module } from './Module.js';
import { registerModule } from '../moduleRegistry.js';
import { vertSrc } from '../shaders/vert.js';
import { skeletonMaskFrag } from '../shaders/skeleton.js';
import { PixelReadback } from './slowscanjam/PixelReadback.js';
import { polylinePieces, PointStream, XYOutputs } from './latk/strokes.js';
import { SegmentRenderer } from './latk/SegmentRenderer.js';

const SAMPLE_RATE = 44100;   // of the X and Y outputs, as Latk's
const MAX_DT = 0.1;          // clamp long stalls so a tab switch doesn't jump the beam
const PREVIEW_KEY = 0x00ff00;  // camera_trace drew its polylines in green
const PREVIEW_WIDTH = 2;       // and 2 px wide

// Twoscilloscope's camera_trace example without the camera and its edge
// shader: a black and white input is thinned to its centre lines, which come
// out on X and Y as one loop of XY audio, as Latk's strokes do, to drive
// Twoscilloscope. Patch Edges in front of it to trace a picture's outlines.
// A trace goes through three stages:
//   1. mask:    the input shrinks to the tracer's grid, thresholded (GPU)
//   2. reading: the mask comes back through a pixel buffer and a fence, so
//               the main thread never waits on the GPU
//   3. tracing: a worker thins it and follows the lines (skeleton/worker.js)
// A mask is read every frame, even while the worker traces the last one. The
// newest waits for the worker, and any older is dropped, so each trace is of
// the freshest mask. X and Y carry the latest trace every frame.
export class SkeletonModule extends Module {
  static uid = 'e87de5ff';

  constructor(glCanvas, id) {
    super('Skeleton', glCanvas, id);
    this.inputs = [{ id: 'da2e', name: 'in', type: 'video' }];
    this.outputs = [{ id: '6141', name: 'x', type: 'control' }, { id: 'd12b', name: 'y', type: 'control' }];
    this.params = {
      threshold: { id: '44e8', value: 0.5, min: 0, max: 1, step: 0.01, label: 'Threshold' },
      // Which shapes are traced: light on dark, or dark on light
      trace: {
        id: '8da7', value: 0, min: 0, max: 1, step: 1, label: 'Trace',
        widget: 'dropdown', valueLabels: ['White', 'Black'],
      },
      // The share of a cell that must pass Threshold for the cell to be part of
      // a shape. 0 takes any part of it, so a line thinner than a cell is kept
      fill: { id: 'a35f', value: 0, min: 0, max: 1, step: 0.01, label: 'Fill' },
      // Cells across the tracer's grid. camera_trace used 256 x 256; here the
      // grid keeps the frame's shape, so 256 is 256 x 192
      resolution: { id: '95f2', value: 256, min: 64, max: 1024, step: 32, label: 'Resolution' },
      // Keeps the last trace on X and Y, and starts no new one
      hold: {
        id: '9036', value: 0, min: 0, max: 1, step: 1, label: 'Hold',
        widget: 'dropdown', valueLabels: ['Off', 'On'],
      },
      // Lines shorter than this, in px of the frame, are left out
      minLength: { id: '4d81', value: 0, min: 0, max: 100, step: 1, label: 'Min Length' },
      // Loops a second on X and Y. A lower rate gives the lines more samples
      loopHz: { id: 'eded', value: 5, min: 1, max: 100, step: 0.1, label: 'Loop Hz' },
    };

    this.maskShader = glCanvas.createShader(vertSrc, skeletonMaskFrag);
    this.maskFBO = null;
    this.readback = new PixelReadback(glCanvas);
    // The node's preview: the traced lines, since X and Y have no picture.
    // They are geometry, so it keeps p5's MSAA (see Framebuffers in ARCHITECTURE.md)
    this.outputFBO = glCanvas.createFramebuffer();
    this.segments = new SegmentRenderer(glCanvas, 'Skeleton');
    this.stream = new PointStream();
    this.xy = new XYOutputs(SAMPLE_RATE);

    // A mask is { cols, rows, width, height }: its grid and the canvas size,
    // with its pixels once they are read
    this.reading = null;     // the mask being read back
    this.pending = null;     // the newest mask read while the worker was busy
    this.tracing = null;     // the mask the worker has
    this.failed = false;     // the worker won't run
    this.traced = [];        // the latest trace, as pieces in px of the canvas
    this.pieces = [];        // those at least Min Length long, on X and Y
    this.minLength = 0;      // the Min Length they were cut to
    this.dirty = true;       // the preview needs drawing
    this.connected = false;

    this.worker = new Worker(new URL('./skeleton/worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => {
      this._takeTrace(e.data);
      this.tracing = null;
      if (this.pending) {
        const mask = this.pending;
        this.pending = null;
        this._send(mask);
      }
    };
    this.worker.onerror = (e) => {
      console.error('Skeleton worker:', e.message);
      this.failed = true;
      this.tracing = null;
      this.pending = null;
    };
    this.lastTime = performance.now() / 1000;
  }

  // Resolution snaps to its steps, so a cable resizes the grid only when it crosses one
  _cols() {
    const p = this.params.resolution;
    return Math.min(p.max, Math.max(p.min, Math.round(p.value / p.step) * p.step));
  }

  _held() {
    return Math.round(this.params.hold.value) === 1;
  }

  process(graph, glCanvas) {
    const now = performance.now() / 1000;
    const dt = Math.min(Math.max(now - this.lastTime, 0), MAX_DT);
    this.lastTime = now;

    if (this.reading) this._pollReadback();
    const input = this.getInput(graph, 0);
    this.connected = !!input;
    if (this._held()) {
      // The trace stays, plugged in or not, and no new mask starts
      this.pending = null;
    } else if (!input) {
      if (this.traced.length > 0) {
        this.traced = [];
        this._cut();
      }
      this.pending = null;
    } else if (!this.reading && !this.failed) {
      this._startMask(input, glCanvas);
    }

    if (this.params.minLength.value !== this.minLength) this._cut();
    if (this.dirty) this._drawPreview(glCanvas);
    // With nothing traced, the loop is all blank, so the beam rests unlit in the middle
    this.xy.publish(this, this.pieces, glCanvas.width, glCanvas.height, dt, this.params.loopHz.value);
  }

  // Shrink the input to the mask and start reading it back
  _startMask(input, glCanvas) {
    const cols = this._cols();
    const rows = Math.max(1, Math.round(cols * glCanvas.height / glCanvas.width));
    if (!this.maskFBO) {
      this.maskFBO = this.createFramebuffer({ width: cols, height: rows, density: 1 });
    } else if (this.maskFBO.width !== cols || this.maskFBO.height !== rows) {
      this.maskFBO.resize(cols, rows);
    }
    const mask = { cols, rows, width: glCanvas.width, height: glCanvas.height };

    this.maskFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.maskShader);
    this.maskShader.setUniform('tex0', input);
    this.maskShader.setUniform('uStep', [1 / cols, 1 / rows]);
    this.maskShader.setUniform('uThreshold', this.params.threshold.value);
    this.maskShader.setUniform('uInvert', Math.round(this.params.trace.value) === 1 ? 1 : 0);
    this.maskShader.setUniform('uFill', this.params.fill.value);
    this.renderQuad();
    this.maskFBO.end();

    // WebGL1 reads at once
    const pixels = this.readback.start(this.maskFBO, cols, rows);
    if (pixels) this._queue({ ...mask, pixels });
    else this.reading = mask;
  }

  // Once a frame, until the mask is in
  _pollReadback() {
    const pixels = this.readback.poll();
    if (pixels === null) return;
    const mask = this.reading;
    this.reading = null;
    if (pixels) this._queue({ ...mask, pixels });
  }

  // To the worker, or to wait for it in place of any older mask. A mask that
  // was still being read when Hold went on is dropped
  _queue(mask) {
    if (this._held()) return;
    if (this.tracing) this.pending = mask;
    else this._send(mask);
  }

  _send(mask) {
    const { pixels, ...size } = mask;
    this.worker.postMessage({ pixels, w: mask.cols, h: mask.rows }, [pixels.buffer]);
    this.tracing = size;
  }

  // The worker's polylines, in cells, as pieces in px of the canvas: each
  // point at its cell's centre. A trace that finishes after the input was
  // unplugged, or after Hold went on, is dropped.
  _takeTrace({ w, h, lengths, points }) {
    if (!this.connected || this._held()) return;
    const { width, height } = this.tracing;
    const sx = width / w, sy = height / h;
    const pieces = [];
    let o = 0;
    for (const n of lengths) {
      const pts = [];
      for (let k = 0; k < n; k++, o += 2) pts.push({ x: (points[o] + 0.5) * sx, y: (points[o + 1] + 0.5) * sy });
      for (const piece of polylinePieces(pts, null, width, height)) pieces.push(piece);
    }
    this.traced = pieces;
    this._cut();
  }

  // The trace without its lines shorter than Min Length. Every point is inside
  // the canvas, so each polyline is one piece
  _cut() {
    this.minLength = this.params.minLength.value;
    this.pieces = this.traced.filter((piece) => piece.length >= this.minLength);
    this.dirty = true;
  }

  _drawPreview(glCanvas) {
    const w = glCanvas.width, h = glCanvas.height;
    let count = 0;
    for (const piece of this.pieces) count += piece.points.length;
    this.stream.reset(count);
    for (const piece of this.pieces) this.stream.addPolyline(piece.points, PREVIEW_KEY, false, w, h);
    this.outputFBO.begin();
    glCanvas.background(0);
    this.segments.drawLines(this.stream, PREVIEW_WIDTH, this.pixelDensity);
    this.outputFBO.end();
    this.dirty = false;
  }

  dispose() {
    this.worker.terminate();
    this.readback.dispose();
    this.segments.dispose();
    if (this.maskFBO) this.maskFBO.remove();
    this.maskFBO = null;
    super.dispose();
  }
}

registerModule('Skeleton', SkeletonModule);
