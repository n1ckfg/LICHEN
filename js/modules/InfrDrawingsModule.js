import { Module } from './Module.js';
import { registerModule } from '../moduleRegistry.js';
import { vertSrc } from '../shaders/vert.js';
import { infrDrawingsInputFrag, infrDrawingsOutputFrag } from '../shaders/infr-drawings.js';
import { PixelReadback } from './slowscanjam/PixelReadback.js';
import { loadOnnxModel } from './img2img/OnnxModel.js';

// informative-drawings-js's fixed-shape fp16 models, each of which takes and
// gives one size. Patches save the choice as its index, so a new size is
// appended, never inserted
const MODELS = [[160, 120], [320, 240], [640, 480]].map(([w, h]) => ({
  w, h, label: `${w} × ${h}`,
  url: new URL(`../../files/models/informative-drawings/informative-drawings_${w}x${h}_fp16.onnx`, import.meta.url).href,
}));
const MAX_TAPS = 8;          // the input shader's loop bound
const INVERT = 1;            // Mode's options
const COLOR = 2;

// Informative Drawings (Chan, Durand and Isola, 2022), a GAN that turns a
// picture into line art, run with ONNX Runtime Web as informative-drawings-js
// does. A frame goes through four stages:
//   1. input:   the input shrinks to the model's size (GPU)
//   2. reading: it comes back through a pixel buffer and a fence, as
//               Skeleton's mask does, so the main thread never waits on the GPU
//   3. drawing: the model runs on WebGPU, or in ORT's WASM worker (img2img/OnnxModel.js)
//   4. output:  its drawing is uploaded and scaled up to the canvas, in the
//               Mode chosen: as drawn, inverted, or inverted and coloured
// A frame is read every frame, even while the model draws the last one. The
// newest waits for the model, and any older is dropped, so each drawing is of
// the freshest frame. The output keeps the latest drawing, and stays empty
// until the first. A frame keeps the model it was read for, so frames already
// on their way when the Model changes still draw, at their own size.
export class InfrDrawingsModule extends Module {
  static uid = '8faf6307';

  constructor(glCanvas, id) {
    super('InfrDrawings', glCanvas, id);
    this.inputs = [{ id: '3a77', name: 'in', type: 'video' }];
    this.outputs = [{ id: '1655', name: 'out', type: 'video' }];
    this.params = {
      // The model's size. Each is 8.6 MB, loaded the first time a node picks it
      model: {
        id: 'e3fc', value: 1, min: 0, max: MODELS.length - 1, step: 1, label: 'Model',
        widget: 'dropdown', valueLabels: MODELS.map((m) => m.label),
      },
      // Default is the model's dark lines on white. Invert gives white lines on
      // black, and Color multiplies those by the input
      mode: {
        id: 'c9d6', value: 0, min: 0, max: 2, step: 1, label: 'Mode',
        widget: 'dropdown', valueLabels: ['Default', 'Invert', 'Color'],
      },
    };

    this.inputShader = glCanvas.createShader(vertSrc, infrDrawingsInputFrag);
    // Resized to the model's size when a frame starts
    this.inputFBO = this.createFramebuffer({ width: MODELS[1].w, height: MODELS[1].h, density: 1 });
    this.readback = new PixelReadback(glCanvas);
    this.drawings = new Map();  // MODELS entry -> its drawings' texture
    this.drawing = null;        // the latest drawing's texture
    this.createShader(infrDrawingsOutputFrag);
    this.createOutputFBO();

    this.chosen = null;       // the MODELS entry picked last, loaded or not
    this.loadToken = 0;       // so a slow model can't land after a newer choice
    this.model = null;        // the model new frames go to, once one has loaded
    this.spec = null;         // its MODELS entry
    this.hasDrawing = false;  // a drawing has been uploaded
    this.drawnMode = null;    // the Mode the output was last drawn in, or null to redraw
    this.failed = false;      // the model won't run
    this.reading = null;      // the frame being read back
    this.pending = null;      // the newest frame read while the model was busy
    this.running = false;     // the model is drawing a frame
    this.result = null;       // the latest drawing, until it is uploaded
    this.disposed = false;
  }

  // Follow the Model drop-down, whether a click or a cable moved it. The
  // previous model keeps drawing until the new one is ready
  _syncModel() {
    const spec = MODELS[Math.round(this.params.model.value)];
    if (spec === this.chosen) return;
    this.chosen = spec;
    const token = ++this.loadToken;
    loadOnnxModel(spec.url).then(
      (model) => {
        if (token !== this.loadToken) return;
        this.model = model;
        this.spec = spec;
        this.failed = false;
      },
      (e) => console.error(`InfrDrawings: the ${spec.label} model failed to load:`, e),
    );
  }

  process(graph, glCanvas) {
    this._syncModel();
    if (this.reading) this._pollReadback();
    if (this.result) this._uploadResult();
    const input = this.getInput(graph, 0);
    this._drawOutput(input, glCanvas);
    if (input && this.model && !this.failed && !this.reading) this._startFrame(input, glCanvas);
  }

  // Shrink the input to the model's size and start reading it back
  _startFrame(input, glCanvas) {
    const { w, h } = this.spec;
    if (this.inputFBO.width !== w || this.inputFBO.height !== h) this.inputFBO.resize(w, h);
    // Input pixels across a model pixel, two to each tap
    const span = input.width * input.density / w;
    this.inputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.inputShader);
    this.inputShader.setUniform('tex0', input);
    this.inputShader.setUniform('uCell', [1 / w, 1 / h]);
    this.inputShader.setUniform('uTaps', Math.min(MAX_TAPS, Math.max(1, Math.round(span / 2))));
    this.renderQuad();
    this.inputFBO.end();

    // WebGL1 reads at once
    const frame = { model: this.model, spec: this.spec, pixels: null };
    frame.pixels = this.readback.start(this.inputFBO, w, h);
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

  // To the model, or to wait for it in place of any older frame
  _queue(frame) {
    if (this.running) this.pending = frame;
    else this._run(frame);
  }

  async _run({ model, spec, pixels }) {
    this.running = true;
    // RGBA bytes, rows top first, to planar RGB in 0..1, as [1, 3, H, W]
    const n = spec.w * spec.h;
    const data = new Float32Array(3 * n);
    for (let i = 0, p = 0; p < n; i += 4, p++) {
      data[p] = pixels[i] / 255;
      data[p + n] = pixels[i + 1] / 255;
      data[p + 2 * n] = pixels[i + 2] / 255;
    }
    try {
      const input = new model.ort.Tensor('float32', data, [1, 3, spec.h, spec.w]);
      const results = await model.run({ input });
      this.result = { grey: results.output.data, spec };   // grey in 0..1, as [1, 1, H, W]
    } catch (e) {
      console.error(`InfrDrawings: the ${spec.label} model failed to run:`, e);
      if (model === this.model) this.failed = true;
    }
    this.running = false;
    const next = this.pending;
    this.pending = null;
    if (next && !this.failed && !this.disposed) this._run(next);
  }

  _uploadResult() {
    const { grey, spec } = this.result;
    this.drawing = this._drawingFor(spec);
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
    this.hasDrawing = true;
    this.drawnMode = null;
  }

  // A texture for each size, made the first time a drawing of that size comes
  // in. Its pixels are loaded once and rewritten for each drawing
  _drawingFor(spec) {
    let img = this.drawings.get(spec);
    if (!img) {
      img = this.glCanvas._pInst.createImage(spec.w, spec.h);
      img.loadPixels();
      this.drawings.set(spec, img);
    }
    return img;
  }

  // Default and Invert draw only when the drawing or the Mode changes. Color
  // follows the input, so it draws every frame; the drawing lags the input by
  // however long the model takes. With nothing plugged in, Color draws as Invert
  _drawOutput(input, glCanvas) {
    if (!this.hasDrawing) return;
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
    for (const img of this.drawings.values()) {
      const tex = renderer.textures.get(img);
      if (!tex) continue;
      renderer.GL.deleteTexture(tex.glTex);
      renderer.textures.delete(img);
    }
    this.drawings.clear();
    this.drawing = null;
    super.dispose();
  }
}

registerModule('InfrDrawings', InfrDrawingsModule);
