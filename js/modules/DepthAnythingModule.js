import { Module } from './Module.js';
import { registerModule } from '../moduleRegistry.js';
import { vertSrc } from '../shaders/vert.js';
import { infrDrawingsInputFrag } from '../shaders/infr-drawings.js';
import { depthAnythingOutputFrag } from '../shaders/depth-anything.js';
import { PixelReadback } from './slowscanjam/PixelReadback.js';
import { loadOnnxModel } from './img2img/OnnxModel.js';

// Depth Anything V2 Small in fp16, as depth-anything-v2-js runs it. Its input
// sizes are dynamic, so the one model takes every Size
const MODEL_URL = new URL('../../files/models/depth-anything/depth-anything-v2-small_fp16.onnx', import.meta.url).href;
const PATCH = 14;            // the ViT's patch size: each side of the input is a multiple of it
// ImageNet's mean and standard deviation, which the model's input is normalized by
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];
const MAX_TAPS = 8;          // the input shader's loop bound

// The model's input sizes: depth-anything-v2-js's short sides, with the long
// side fitted to LICHEN's 4:3 frame. 518 is the size the model was trained at.
// Patches save the choice as its index, so a new size is appended, never inserted
const SIZES = [182, 252, 322, 392, 518].map((h) => {
  const w = Math.round(h * 4 / 3 / PATCH) * PATCH;
  return { w, h, label: `${w} × ${h}` };
});

// Depth Anything V2 (Yang et al., 2024), a monocular depth model: it estimates
// how near each point of a picture is. A frame goes through the same four
// stages as InfrDrawings':
//   1. input:   the input shrinks to the Size chosen (GPU), with InfrDrawings'
//               input shader
//   2. reading: it comes back through a pixel buffer and a fence, as
//               Skeleton's mask does, so the main thread never waits on the GPU
//   3. depth:   the model runs on WebGPU, or in ORT's WASM worker (img2img/OnnxModel.js)
//   4. output:  its depth is normalized to the frame's nearest and farthest
//               points, uploaded, and scaled up to the canvas in the Color chosen
// A frame is read every frame, even while the model works on the last one. The
// newest waits for the model, and any older is dropped, so each depth map is of
// the freshest frame. The output keeps the latest map, and stays empty until
// the first.
export class DepthAnythingModule extends Module {
  static uid = '9efdd800';

  constructor(glCanvas, id) {
    super('DepthAnything', glCanvas, id);
    this.inputs = [{ id: '398f', name: 'in', type: 'video' }];
    this.outputs = [{ id: '5ac8', name: 'out', type: 'video' }];
    this.params = {
      // The model's input size. A larger one sees finer depth, and takes longer
      size: {
        id: '624f', value: 1, min: 0, max: SIZES.length - 1, step: 1, label: 'Size',
        widget: 'dropdown', valueLabels: SIZES.map((s) => s.label),
      },
      // Grey shows near as white. Turbo runs from blue (far) to red (near)
      colormap: {
        id: '9890', value: 0, min: 0, max: 1, step: 1, label: 'Color',
        widget: 'dropdown', valueLabels: ['Grey', 'Turbo'],
      },
      // Swaps near and far
      invert: {
        id: 'ae69', value: 0, min: 0, max: 1, step: 1, label: 'Invert',
        widget: 'dropdown', valueLabels: ['Off', 'On'],
      },
    };

    this.inputShader = glCanvas.createShader(vertSrc, infrDrawingsInputFrag);
    // Resized to the Size chosen when a frame starts
    this.inputFBO = this.createFramebuffer({ width: SIZES[1].w, height: SIZES[1].h, density: 1 });
    this.readback = new PixelReadback(glCanvas);
    this.maps = new Map();      // a size, as 'w x h' -> its depth maps' texture
    this.map = null;            // the latest depth map's texture
    this.createShader(depthAnythingOutputFrag);
    this.createOutputFBO();

    this.loading = false;     // the model has been asked for
    this.model = null;        // the model, once it has loaded
    this.failed = false;      // the model won't load or run
    this.hasMap = false;      // a depth map has been uploaded
    this.drawnLook = null;    // the Color and Invert the output was last drawn in, or null to redraw
    this.reading = null;      // the frame being read back
    this.pending = null;      // the newest frame read while the model was busy
    this.running = false;     // the model is working on a frame
    this.result = null;       // the latest depth map, until it is uploaded
    this.disposed = false;
  }

  // The model is about 50 MB, so it is loaded the first time a node runs, and
  // then shared by every node
  _load() {
    if (this.loading) return;
    this.loading = true;
    loadOnnxModel(MODEL_URL).then(
      (model) => { this.model = model; },
      (e) => {
        console.error('DepthAnything: the model failed to load:', e);
        this.failed = true;
      },
    );
  }

  process(graph, glCanvas) {
    this._load();
    if (this.reading) this._pollReadback();
    if (this.result) this._uploadResult();
    this._drawOutput(glCanvas);
    const input = this.getInput(graph, 0);
    if (input && this.model && !this.failed && !this.reading) this._startFrame(input, glCanvas);
  }

  // Shrink the input to the Size chosen and start reading it back
  _startFrame(input, glCanvas) {
    const size = SIZES[Math.round(this.params.size.value)];
    const { w, h } = size;
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
    const frame = { size, pixels: null };
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

  async _run({ size, pixels }) {
    this.running = true;
    const model = this.model;
    // RGBA bytes, rows top first, to planar RGB normalized as ImageNet's, as [1, 3, H, W].
    // A fresh array each frame, since ORT's WASM proxy takes it over
    const { w, h } = size;
    const n = w * h;
    const data = new Float32Array(3 * n);
    for (let i = 0, p = 0; p < n; i += 4, p++) {
      data[p] = (pixels[i] / 255 - MEAN[0]) / STD[0];
      data[p + n] = (pixels[i + 1] / 255 - MEAN[1]) / STD[1];
      data[p + 2 * n] = (pixels[i + 2] / 255 - MEAN[2]) / STD[2];
    }
    try {
      const input = new model.ort.Tensor('float32', data, [1, 3, h, w]);
      const results = await model.run({ pixel_values: input });
      // Relative inverse depth, larger nearer, as [1, H, W]
      const depth = results.predicted_depth;
      this.result = { depth: depth.data, w: depth.dims[2], h: depth.dims[1] };
    } catch (e) {
      console.error(`DepthAnything: the model failed to run at ${size.label}:`, e);
      this.failed = true;
    }
    this.running = false;
    const next = this.pending;
    this.pending = null;
    if (next && !this.failed && !this.disposed) this._run(next);
  }

  // Normalized to the map's own nearest and farthest points, as
  // depth-anything-v2-js does, so near is 255 and far 0
  _uploadResult() {
    const { depth, w, h } = this.result;
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < depth.length; i++) {
      const v = depth[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const scale = max > min ? 255 / (max - min) : 0;

    this.map = this._mapFor(w, h);
    const px = this.map.pixels;
    for (let p = 0, i = 0; p < depth.length; p++, i += 4) {
      const v = Math.round((depth[p] - min) * scale);
      px[i] = v;
      px[i + 1] = v;
      px[i + 2] = v;
      px[i + 3] = 255;
    }
    this.map.updatePixels();
    this.result = null;
    this.hasMap = true;
    this.drawnLook = null;
  }

  // A texture for each size, made the first time a map of that size comes in.
  // Its pixels are loaded once and rewritten for each map
  _mapFor(w, h) {
    const key = `${w} x ${h}`;
    let img = this.maps.get(key);
    if (!img) {
      img = this.glCanvas._pInst.createImage(w, h);
      img.loadPixels();
      this.maps.set(key, img);
    }
    return img;
  }

  // Draws only when the map, the Color or Invert changes
  _drawOutput(glCanvas) {
    if (!this.hasMap) return;
    const colormap = Math.round(this.params.colormap.value);
    const invert = Math.round(this.params.invert.value);
    const look = colormap * 2 + invert;
    if (look === this.drawnLook) return;
    this.drawnLook = look;

    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('tex0', this.map);
    this.shader.setUniform('uColormap', colormap);
    this.shader.setUniform('uInvert', invert);
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
    for (const img of this.maps.values()) {
      const tex = renderer.textures.get(img);
      if (!tex) continue;
      renderer.GL.deleteTexture(tex.glTex);
      renderer.textures.delete(img);
    }
    this.maps.clear();
    this.map = null;
    super.dispose();
  }
}

registerModule('DepthAnything', DepthAnythingModule);
