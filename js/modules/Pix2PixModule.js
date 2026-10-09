import { Module } from './Module.js';
import { registerModule } from '../moduleRegistry.js';
import { vertSrc } from '../shaders/vert.js';
import { infrDrawingsInputFrag } from '../shaders/infr-drawings.js';
import { pix2pixOutputFrag } from '../shaders/pix2pix.js';
import { PixelReadback } from './slowscanjam/PixelReadback.js';
import { loadOnnxModel, Backoff } from './img2img/OnnxModel.js';

// pix2pix U-Net generators trained for Latk, converted by tools/pix2pix-onnx.py
// to int8 weights run in fp16. Each takes and gives 256 x 256. `light` marks a
// model that draws light on dark, which Color then doesn't invert. Patches
// save the choice as its index, so a new model is appended, never inserted
const MODELS = [
  { file: 'neuralcontours_140_net_G', label: 'Neural Contours', light: false },
  { file: 'pix2pix003-002_140_net_G', label: 'pix2pix 003', light: true },
  { file: 'pix2pix004-002_140_net_G', label: 'pix2pix 004', light: false },
  { file: 'pix2pix002-001_60_net_G', label: 'pix2pix 002-001', light: false },
  { file: 'pix2pix002-002_60_net_G', label: 'pix2pix 002-002', light: false },
  { file: 'pix2pix002-004_60_net_G', label: 'pix2pix 002-004', light: false },
  // Light lines on black in, a shaded picture out: pix2pix 003's lines suit it
  { file: 'contour_pix2pix_195_net_G', label: 'Contour', light: true },
  // Lines or depth in, thick light strokes on black out
  { file: 'contour_reverse_pix2pix_195_net_G', label: 'Contour Reverse', light: true },
].map((m) => ({
  ...m,
  url: new URL(`../../files/models/pix2pix/${m.file}_q8_fp16.onnx`, import.meta.url).href,
}));
const SIZE = 256;
// ORT turns the int8 weights back into fp16 once, when the session starts,
// instead of on every run (14 ms a run on WebGPU, not 18)
const SESSION_OPTIONS = { extra: { session: { disable_quant_qdq: '1' } } };
const MAX_TAPS = 8;          // the input shader's loop bound
const INVERT = 1;            // Mode's options
const COLOR = 2;

// pix2pix (Isola, Zhu, Zhou and Efros, 2017), an image-to-image GAN, here with
// generators trained to turn a picture into line art for Latk. They run with
// ONNX Runtime Web, in InfrDrawings' four stages:
//   1. input:   the input shrinks to 256 x 256 (GPU), squashing the frame
//               square as Latk did, with InfrDrawings' input shader
//   2. reading: it comes back through a pixel buffer and a fence, as
//               Skeleton's mask does, so the main thread never waits on the GPU
//   3. drawing: the model runs on WebGPU, or in ORT's WASM worker (img2img/OnnxModel.js)
//   4. output:  its drawing is uploaded and scaled up to the canvas, which
//               stretches it back, in the Mode chosen
// A frame is read every frame, even while the model draws the last one. The
// newest waits for the model, and any older is dropped, so each drawing is of
// the freshest frame. The output keeps the latest drawing, and stays empty
// until the first. A frame keeps the model it was read for, so frames already
// on their way when the Model changes still draw.
export class Pix2PixModule extends Module {
  static uid = 'f3b183da';

  constructor(glCanvas, id) {
    super('Pix2Pix', glCanvas, id);
    this.inputs = [{ id: '0f3f', name: 'in', type: 'video' }];
    this.outputs = [{ id: '101c', name: 'out', type: 'video' }];
    this.params = {
      // Each is 54 MB, loaded the first time a node picks it
      model: {
        id: 'c338', value: 0, min: 0, max: MODELS.length - 1, step: 1, label: 'Model',
        widget: 'dropdown', valueLabels: MODELS.map((m) => m.label),
      },
      // Default is the model's drawing as it is. Invert inverts it, and Color
      // gives its lines in the input's colours, on black
      mode: {
        id: 'bc67', value: 0, min: 0, max: 2, step: 1, label: 'Mode',
        widget: 'dropdown', valueLabels: ['Default', 'Invert', 'Color'],
      },
    };

    this.inputShader = glCanvas.createShader(vertSrc, infrDrawingsInputFrag);
    this.inputFBO = this.createFramebuffer({ width: SIZE, height: SIZE, density: 1 });
    this.readback = new PixelReadback(glCanvas);
    this.drawing = null;        // the drawings' texture, made with the first one
    this.createShader(pix2pixOutputFrag);
    this.createOutputFBO();

    this.chosen = null;       // the MODELS entry loaded or loading, or null if it failed
    this.asked = null;        // the MODELS entry asked for last, loaded or not
    this.loadToken = 0;       // so a slow model can't land after a newer choice
    this.model = null;        // the model new frames go to, once one has loaded
    this.spec = null;         // its MODELS entry
    this.drawnSpec = null;    // the MODELS entry of the latest drawing, once one is uploaded
    this.drawnMode = null;    // the Mode the output was last drawn in, or null to redraw
    // After a failure, a load or a run is tried again later (see Backoff). A
    // new Model is loaded at once, and runs as soon as it is in
    this.loadRetry = new Backoff();
    this.runRetry = new Backoff();
    this.reading = null;      // the frame being read back
    this.pending = null;      // the newest frame read while the model was busy
    this.running = false;     // the model is drawing a frame
    this.result = null;       // the latest drawing, until it is uploaded
    this.disposed = false;
  }

  // Follow the Model drop-down, whether a click or a cable moved it. The
  // previous model keeps drawing until the new one is ready, or while one that
  // failed to load waits to be tried again
  _syncModel() {
    const spec = MODELS[Math.round(this.params.model.value)];
    if (spec === this.chosen) return;
    if (spec === this.asked && !this.loadRetry.ready) return;
    this.chosen = this.asked = spec;
    const token = ++this.loadToken;
    loadOnnxModel(spec.url, SESSION_OPTIONS).then(
      (model) => {
        if (token !== this.loadToken) return;
        this.model = model;
        this.spec = spec;
        this.loadRetry.reset();
        this.runRetry.reset();
      },
      (e) => {
        if (token !== this.loadToken) return;
        this.chosen = null;
        const wait = this.loadRetry.fail();
        console.error(`Pix2Pix: the ${spec.label} model failed to load, so it will try again in ${wait / 1000} s:`, e);
      },
    );
  }

  process(graph, glCanvas) {
    this._syncModel();
    if (this.reading) this._pollReadback();
    if (this.result) this._uploadResult();
    const input = this.getInput(graph, 0);
    this._drawOutput(input, glCanvas);
    if (input && this.model && !this._waiting(this.model) && !this.reading) this._startFrame(input, glCanvas);
  }

  // Frames of model wait while it is the model new frames go to, its last run
  // failed, and the wait isn't over
  _waiting(model) {
    return model === this.model && !this.runRetry.ready;
  }

  // Shrink the input to 256 x 256 and start reading it back
  _startFrame(input, glCanvas) {
    // Input pixels across a model pixel, two to each tap
    const span = input.width * input.density / SIZE;
    this.inputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.inputShader);
    this.inputShader.setUniform('tex0', input);
    this.inputShader.setUniform('uCell', [1 / SIZE, 1 / SIZE]);
    this.inputShader.setUniform('uTaps', Math.min(MAX_TAPS, Math.max(1, Math.round(span / 2))));
    this.renderQuad();
    this.inputFBO.end();

    // WebGL1 reads at once
    const frame = { model: this.model, spec: this.spec, pixels: null };
    frame.pixels = this.readback.start(this.inputFBO, SIZE, SIZE);
    if (frame.pixels) this._queue(frame);
    else this.reading = frame;
  }

  // Once a frame, until the frame is in
  _pollReadback() {
    const pixels = this.readback.poll();
    if (pixels === null) return;
    const frame = this.reading;
    this.reading = null;
    if (pixels) this._queue({ ...frame, pixels });
  }

  // To the model, or to wait for it in place of any older frame. A frame read
  // back after its model failed is dropped
  _queue(frame) {
    if (this._waiting(frame.model)) return;
    if (this.running) this.pending = frame;
    else this._run(frame);
  }

  async _run({ model, spec, pixels }) {
    this.running = true;
    // RGBA bytes, rows top first, to planar RGB in -1..1, as [1, 3, 256, 256]
    const n = SIZE * SIZE;
    const data = new Float32Array(3 * n);
    for (let i = 0, p = 0; p < n; i += 4, p++) {
      data[p] = pixels[i] / 127.5 - 1;
      data[p + n] = pixels[i + 1] / 127.5 - 1;
      data[p + 2 * n] = pixels[i + 2] / 127.5 - 1;
    }
    try {
      const input = new model.ort.Tensor('float32', data, [1, 3, SIZE, SIZE]);
      const results = await model.run({ input });
      this.result = { rgb: results.output.data, spec };   // RGB in -1..1, as [1, 3, 256, 256]
      if (model === this.model) this.runRetry.reset();
    } catch (e) {
      // Only the model new frames go to waits: a frame of the one before it, still on its way, fails alone
      if (model === this.model) {
        const wait = this.runRetry.fail();
        console.error(`Pix2Pix: the ${spec.label} model failed to run, so it will try again in ${wait / 1000} s:`, e);
      } else {
        console.error(`Pix2Pix: the ${spec.label} model failed to run:`, e);
      }
    }
    this.running = false;
    const next = this.pending;
    this.pending = null;
    if (next && !this._waiting(next.model) && !this.disposed) this._run(next);
  }

  // Planar RGB in -1..1 to RGBA bytes, as the models' training mapped it
  _uploadResult() {
    const { rgb, spec } = this.result;
    if (!this.drawing) {
      this.drawing = this.glCanvas._pInst.createImage(SIZE, SIZE);
      this.drawing.loadPixels();
    }
    const px = this.drawing.pixels;   // clamped, so out-of-range values stop at 0 and 255
    const n = SIZE * SIZE;
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      px[i] = (rgb[p] + 1) * 127.5;
      px[i + 1] = (rgb[p + n] + 1) * 127.5;
      px[i + 2] = (rgb[p + 2 * n] + 1) * 127.5;
      px[i + 3] = 255;
    }
    this.drawing.updatePixels();
    this.result = null;
    this.drawnSpec = spec;
    this.drawnMode = null;
  }

  // Default and Invert draw only when the drawing or the Mode changes. Color
  // follows the input, so it draws every frame; the drawing lags the input by
  // however long the model takes. With nothing plugged in, Color draws as Invert
  _drawOutput(input, glCanvas) {
    if (!this.drawnSpec) return;
    let mode = Math.round(this.params.mode.value);
    if (mode === COLOR && !input) mode = INVERT;
    if (mode === this.drawnMode && mode !== COLOR) return;
    this.drawnMode = mode;

    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('tex0', this.drawing);
    // Every sampler needs a texture, so the drawing stands in for the input
    this.shader.setUniform('texIn', input || this.drawing);
    this.shader.setUniform('uMode', mode);
    this.shader.setUniform('uLight', this.drawnSpec.light ? 1 : 0);
    this.renderQuad();
    this.outputFBO.end();
  }

  dispose() {
    this.disposed = true;
    this.pending = null;
    this.readback.dispose();
    this.inputFBO.remove();
    this.inputFBO = null;
    // p5 keeps a GL texture for every image it has drawn and never frees it
    const renderer = this.glCanvas._renderer;
    const tex = this.drawing && renderer.textures.get(this.drawing);
    if (tex) {
      renderer.GL.deleteTexture(tex.glTex);
      renderer.textures.delete(this.drawing);
    }
    this.drawing = null;
    super.dispose();
  }
}

registerModule('Pix2Pix', Pix2PixModule);
