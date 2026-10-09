import { Module } from './Module.js';
import { registerModule } from '../moduleRegistry.js';
import { vertSrc } from '../shaders/vert.js';
import { passthroughFrag } from '../shaders/passthrough.js';
import { infrDrawingsInputFrag } from '../shaders/infr-drawings.js';
import { PixelReadback } from './slowscanjam/PixelReadback.js';
import { loadOnnxModel } from './gan/OnnxModel.js';

// informative-drawings-js's fixed-shape fp16 model, which takes and gives 320 x 240
const MODEL_URL = new URL('../../files/models/informative-drawings/model_320x240_fp16.onnx', import.meta.url).href;
const MODEL_W = 320;
const MODEL_H = 240;
const MAX_TAPS = 8;          // the input shader's loop bound

// Informative Drawings (Chan, Durand and Isola, 2022), a GAN that turns a
// picture into line art, run with ONNX Runtime Web as informative-drawings-js
// does. A frame goes through four stages:
//   1. input:   the input shrinks to the model's 320 x 240 (GPU)
//   2. reading: it comes back through a pixel buffer and a fence, as
//               Skeleton's mask does, so the main thread never waits on the GPU
//   3. drawing: the model runs on WebGPU, or in ORT's WASM worker (gan/OnnxModel.js)
//   4. output:  its drawing is uploaded and scaled up to the canvas
// A frame is read every frame, even while the model draws the last one. The
// newest waits for the model, and any older is dropped, so each drawing is of
// the freshest frame. The output keeps the latest drawing, and stays empty
// until the first.
export class InfrDrawingsModule extends Module {
  static uid = '8faf6307';

  constructor(glCanvas, id) {
    super('InfrDrawings', glCanvas, id);
    this.inputs = [{ id: '3a77', name: 'in', type: 'video' }];
    this.outputs = [{ id: '1655', name: 'out', type: 'video' }];

    this.inputShader = glCanvas.createShader(vertSrc, infrDrawingsInputFrag);
    this.inputFBO = this.createFramebuffer({ width: MODEL_W, height: MODEL_H, density: 1 });
    this.readback = new PixelReadback(glCanvas);
    // The model's drawing, as a texture. Its pixels are loaded once and
    // rewritten for each drawing
    this.drawing = glCanvas._pInst.createImage(MODEL_W, MODEL_H);
    this.drawing.loadPixels();
    this.createShader(passthroughFrag);
    this.createOutputFBO();

    this.model = null;
    this.failed = false;      // the model won't load or run
    this.reading = false;     // a frame is being read back
    this.pending = null;      // the newest frame read while the model was busy
    this.running = false;     // the model is drawing a frame
    this.result = null;       // the latest drawing, until it is uploaded
    this.disposed = false;

    loadOnnxModel(MODEL_URL).then(
      (model) => { this.model = model; },
      (e) => {
        console.error('InfrDrawings: the model failed to load:', e);
        this.failed = true;
      },
    );
  }

  process(graph, glCanvas) {
    if (this.reading) this._pollReadback();
    if (this.result) this._drawResult(glCanvas);
    const input = this.getInput(graph, 0);
    if (input && this.model && !this.failed && !this.reading) this._startFrame(input, glCanvas);
  }

  // Shrink the input to the model's size and start reading it back
  _startFrame(input, glCanvas) {
    // Input pixels across a model pixel, two to each tap
    const span = input.width * input.density / MODEL_W;
    this.inputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.inputShader);
    this.inputShader.setUniform('tex0', input);
    this.inputShader.setUniform('uCell', [1 / MODEL_W, 1 / MODEL_H]);
    this.inputShader.setUniform('uTaps', Math.min(MAX_TAPS, Math.max(1, Math.round(span / 2))));
    this.renderQuad();
    this.inputFBO.end();

    // WebGL1 reads at once
    const pixels = this.readback.start(this.inputFBO, MODEL_W, MODEL_H);
    if (pixels) this._queue(pixels);
    else this.reading = true;
  }

  // Once a frame, until the frame is in
  _pollReadback() {
    const pixels = this.readback.poll();
    if (pixels === null) return;
    this.reading = false;
    if (pixels) this._queue(pixels);
  }

  // To the model, or to wait for it in place of any older frame
  _queue(pixels) {
    if (this.running) this.pending = pixels;
    else this._run(pixels);
  }

  async _run(pixels) {
    this.running = true;
    // RGBA bytes, rows top first, to planar RGB in 0..1, as [1, 3, H, W]
    const n = MODEL_W * MODEL_H;
    const data = new Float32Array(3 * n);
    for (let i = 0, p = 0; p < n; i += 4, p++) {
      data[p] = pixels[i] / 255;
      data[p + n] = pixels[i + 1] / 255;
      data[p + 2 * n] = pixels[i + 2] / 255;
    }
    try {
      const input = new this.model.ort.Tensor('float32', data, [1, 3, MODEL_H, MODEL_W]);
      const results = await this.model.run({ input });
      this.result = results.output.data;   // grey in 0..1, as [1, 1, H, W]
    } catch (e) {
      console.error('InfrDrawings: the model failed to run:', e);
      this.failed = true;
    }
    this.running = false;
    if (this.pending && !this.failed && !this.disposed) {
      const next = this.pending;
      this.pending = null;
      this._run(next);
    }
  }

  _drawResult(glCanvas) {
    const grey = this.result;
    const px = this.drawing.pixels;
    for (let p = 0, i = 0; p < grey.length; p++, i += 4) {
      const v = grey[p] * 255;
      px[i] = v;
      px[i + 1] = v;
      px[i + 2] = v;
      px[i + 3] = 255;
    }
    this.drawing.updatePixels();
    this.result = null;

    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('tex0', this.drawing);
    this.renderQuad();
    this.outputFBO.end();
  }

  dispose() {
    this.disposed = true;
    this.pending = null;
    this.readback.dispose();
    this.inputFBO.remove();
    this.inputFBO = null;
    super.dispose();
  }
}

registerModule('InfrDrawings', InfrDrawingsModule);
