// HyperCard: the input in 1-bit black and white. The Mode drop-down picks how:
//
// Fast (the default) is the module's original one-pass shader: a 4x4 ordered
// pattern mixed into the threshold.
//
// Accurate dithers as HyperCard and MacPaint did, with Bill Atkinson's error
// diffusion, run exactly. Atkinson is sequential, so it runs on the CPU in a
// worker, one pixel per logical pixel of the frame:
//   1. the input's luminance is drawn into lumaFBO, at density 1
//   2. it is read back behind a fence (PixelReadback, as Skeleton reads its mask)
//   3. the worker dithers it and sends it back, and it is uploaded to resultFBO
//   4. resultFBO is drawn into the output, each logical pixel one solid block
// So Accurate runs a frame or two behind the input.
import { Module } from './Module.js';
import { vertSrc } from '../shaders/vert.js';
import { hypercardFrag, hypercardLumaFrag, hypercardResultFrag } from '../shaders/hypercard.js';
import { PixelReadback } from './slowscanjam/PixelReadback.js';
import { registerModule } from '../moduleRegistry.js';

const FAST = 0;
const ACCURATE = 1;

export class HyperCardModule extends Module {
  static uid = '4b4270bd';

  constructor(glCanvas, id) {
    super('HyperCard', glCanvas, id);
    this.inputs = [{ id: 'a0ef', name: 'in', type: 'video' }];
    this.outputs = [{ id: '9f86', name: 'out', type: 'video' }];
    this.params = {
      mode: {
        id: '7cc4', value: FAST, min: 0, max: 1, step: 1, label: 'Mode', widget: 'dropdown',
        valueLabels: ['Fast', 'Accurate'],
      },
      // The luminance at or above which a pixel is white. In Accurate it is the
      // threshold before the pixel's error is diffused; Atkinson's own is 0.5.
      finalThreshold: { id: '24af', value: 0.4, min: 0, max: 1, step: 0.01, label: 'Thresh' },
    };
    this.createShader(hypercardFrag);
    this.createOutputFBO();

    // Accurate's buffers, readback and worker, made the first time it runs
    this.lumaShader = null;
    this.resultShader = null;
    this.lumaFBO = null;
    this.resultFBO = null;
    this.readback = null;
    this.worker = null;
    this.reading = null;       // the size of the luminance being read back
    this.pending = null;       // the newest luminance read while the worker was busy
    this.dithering = false;    // the worker has one
    this.failed = false;       // the worker won't run
    this.dirty = false;        // resultFBO has a picture the output hasn't shown
    this.accurate = false;     // Accurate was the mode this frame
    this.connected = false;
  }

  _mode() {
    // Rounded, as the drop-down's label is, so a cable can't land between modes
    return Math.round(this.params.mode.value) === ACCURATE ? ACCURATE : FAST;
  }

  process(graph, glCanvas) {
    const input = this.getInput(graph, 0);
    this.connected = !!input;
    this.accurate = this._mode() === ACCURATE;
    if (this.reading) this._pollReadback();
    if (!input) {
      this.pending = null;
      return;
    }
    if (this.accurate) this._processAccurate(input, glCanvas);
    else this._processFast(input, glCanvas);
  }

  _processFast(input, glCanvas) {
    // A picture Accurate has waiting would be stale by the time it came back
    this.pending = null;
    this.dirty = false;
    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('tex0', input);
    this.shader.setUniform('finalThreshold', this.params.finalThreshold.value);
    this.shader.setUniform('uResolution', [glCanvas.width, glCanvas.height]);
    this.renderQuad();
    this.outputFBO.end();
  }

  _processAccurate(input, glCanvas) {
    if (!this.readback) this._startAccurate(glCanvas);
    // A new picture starts every frame, even while the worker has the last one.
    // The newest waits for it, and any older is dropped.
    if (!this.reading && !this.failed) this._startRead(input, glCanvas);

    // Until the first picture comes back, the output keeps what it last showed
    if (this.dirty) {
      this.outputFBO.begin();
      glCanvas.clear();
      glCanvas.shader(this.resultShader);
      this.resultShader.setUniform('tex0', this.resultFBO);
      this.renderQuad();
      this.outputFBO.end();
      this.dirty = false;
    }
  }

  _startAccurate(glCanvas) {
    this.lumaShader = glCanvas.createShader(vertSrc, hypercardLumaFrag);
    this.resultShader = glCanvas.createShader(vertSrc, hypercardResultFrag);
    this.readback = new PixelReadback(glCanvas);
    this.worker = new Worker(new URL('./hypercard/worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => {
      this.dithering = false;
      this._takeResult(e.data);
      if (this.pending) {
        const job = this.pending;
        this.pending = null;
        this._send(job);
      }
    };
    this.worker.onerror = (e) => {
      console.error('HyperCard worker:', e.message);
      this.failed = true;
      this.dithering = false;
      this.pending = null;
    };
  }

  // The input's luminance at the frame's logical size, and start reading it back
  _startRead(input, glCanvas) {
    const w = glCanvas.width;
    const h = glCanvas.height;
    if (!this.lumaFBO) {
      this.lumaFBO = this.createFramebuffer({ width: w, height: h, density: 1 });
    } else if (this.lumaFBO.width !== w || this.lumaFBO.height !== h) {
      this.lumaFBO.resize(w, h);
    }
    this.lumaFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.lumaShader);
    this.lumaShader.setUniform('tex0', input);
    this.renderQuad();
    this.lumaFBO.end();

    // WebGL1 reads at once
    const pixels = this.readback.start(this.lumaFBO, w, h);
    if (pixels) this._queue({ w, h, pixels });
    else this.reading = { w, h };
  }

  // Once a frame, until the luminance is in. One read while Fast was chosen is
  // dropped.
  _pollReadback() {
    const pixels = this.readback.poll();
    if (pixels === null) return;
    const size = this.reading;
    this.reading = null;
    if (pixels && this.accurate) this._queue({ ...size, pixels });
  }

  _queue(job) {
    if (this.dithering) this.pending = job;
    else this._send(job);
  }

  _send({ w, h, pixels }) {
    this.worker.postMessage(
      { pixels, w, h, threshold: this.params.finalThreshold.value }, [pixels.buffer]);
    this.dithering = true;
  }

  // The worker's picture, uploaded to resultFBO. One that finishes after the
  // input was unplugged, after Fast was chosen, or for a frame size since
  // changed, is dropped.
  _takeResult({ pixels, w, h }) {
    if (!this.connected || !this.accurate) return;
    if (w !== this.glCanvas.width || h !== this.glCanvas.height) return;
    const g = this.glCanvas;
    if (!this.resultFBO) {
      this.resultFBO = this.createFramebuffer({
        width: w, height: h, density: 1, textureFiltering: g.NEAREST,
      });
    } else if (this.resultFBO.width !== w || this.resultFBO.height !== h) {
      this.resultFBO.resize(w, h);
    }
    // p5 has no way to fill a texture from an array, so this writes straight into
    // resultFBO's colour texture, putting back the state it touches, as
    // SegmentRenderer does. Rows come top first, as the readback gave them.
    const gl = g.drawingContext;
    const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
    const prevFlip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
    const prevPremul = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.bindTexture(gl.TEXTURE_2D, this.resultFBO.colorTexture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindTexture(gl.TEXTURE_2D, prevTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, prevFlip);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, prevPremul);
    this.dirty = true;
  }

  // The output came back cleared. Fast fills it next frame, and Accurate with
  // its next picture, at the new size.
  frameResized() {
    this.dirty = false;
  }

  dispose() {
    if (this.worker) this.worker.terminate();
    if (this.readback) this.readback.dispose();
    if (this.lumaFBO) this.lumaFBO.remove();
    if (this.resultFBO) this.resultFBO.remove();
    this.worker = null;
    this.readback = null;
    this.lumaFBO = null;
    this.resultFBO = null;
    this.lumaShader = null;
    this.resultShader = null;
    super.dispose();
  }
}

registerModule('HyperCard', HyperCardModule);
