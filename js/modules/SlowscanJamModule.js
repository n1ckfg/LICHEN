import { Module } from './Module.js';
import { vertSrc } from '../shaders/vert.js';
import {
  slowscanjamDownsampleFrag, slowscanjamLineVert, slowscanjamLineFrag, slowscanjamFadeFrag, SSJ_BATCH,
} from '../shaders/slowscanjam.js';
import { registerModule } from '../moduleRegistry.js';
import { EffectMenu, NONE } from './audiofx/EffectRack.js';
import { PixelReadback } from './slowscanjam/PixelReadback.js';

// The Effect drop-down: None, then Twoscilloscope's effects, one at a time. The
// effects run in the worker, between the encoder and the decoder.
const MENU = new EffectMenu([NONE]);
const PROTECTED = 0;

// The SlowscanJam app's phosphor constants
const CLEAR_INTERVAL = 50;           // ms between fades
const FADE_ALPHA = 0.05;

const SOURCE_W = 320;                // the encoder's source picture is SOURCE_W x lines
const MAX_TEXELS = 1024;             // yccFBO texels per line; longer lines are resampled to fit
const MAX_DT = 0.1;                  // clamp long stalls so a tab switch doesn't queue up fields

let nextGeometryId = 0;

// Passes video through SlowscanJam's Cassette Video codec: each field is
// encoded to the stereo signal, run through Twoscilloscope's audio effects,
// decoded straight back, and drawn as scanlines on a fading phosphor screen.
// A field goes through four stages, one at a time:
//   1. downsample: the input shrinks to the encoder's source picture (GPU)
//   2. reading:    that picture comes back through a pixel buffer and a fence,
//                  so the main thread never waits on the GPU
//   3. coding:     a worker encodes it, runs the effects and decodes the
//                  signal (worker.js)
//   4. drawing:    the lines that come back are drawn on the next frame
export class SlowscanJamModule extends Module {
  constructor(glCanvas, id) {
    super('SlowscanJam', glCanvas, id);
    this.inputs = [{ name: 'in', type: 'video' }];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.historicalInfo = "SlowscanJam";
    // The SlowscanJam app's controls, with its ranges and defaults
    this.params = {
      lines: { value: 200, min: 50, max: 320, step: 10, label: 'Lines' },
      fps: { value: 6, min: 1, max: 10, step: 0.5, label: 'FPS' },
      lineWidth: { value: 5, min: 0.5, max: 5, step: 0.5, label: 'Line Width' },
      brightness: { value: 1, min: 0.5, max: 2, step: 0.1, label: 'Brightness' },
      saturation: { value: 1, min: 0.5, max: 2, step: 0.1, label: 'Saturation' },
      blend: {
        value: 0, min: 0, max: 1, step: 1, label: 'Blend',
        widget: 'dropdown', valueLabels: ['Normal', 'Additive'],
      },
      // None, so a patch saved before the effects plays as it did
      ...MENU.params(0, 0.5, 0.5),
      // Protected keeps the sync pulses out of the effects; Raw runs the whole
      // signal through them, and the picture rolls and tears where they break it
      sync: {
        value: PROTECTED, min: 0, max: 1, step: 1, label: 'Sync',
        widget: 'dropdown', valueLabels: ['Protected', 'Raw'],
      },
    };
    this.fx = MENU.resolve(this.params);

    this.downShader = glCanvas.createShader(vertSrc, slowscanjamDownsampleFrag);
    this.lineShader = glCanvas.createShader(slowscanjamLineVert, slowscanjamLineFrag);
    this.fadeShader = glCanvas.createShader(vertSrc, slowscanjamFadeFrag);
    this.geometry = this._buildGeometry();

    // The phosphor screen: lines are drawn into it and it fades, but it is never
    // cleared, so it is the output. Antialiased with 4 samples, as Chrome gives
    // the original's canvas; p5's default of 2 makes the line edges coarser.
    this.outputFBO = glCanvas.createFramebuffer({ antialias: 4, depth: false });
    this.outputFBO.begin();
    glCanvas.background(0);
    this.outputFBO.end();

    // The decoded lines' samples, one row per line. Float, so the AGC-normalized
    // levels arrive as the decoder left them, and sized up on demand.
    this.yccFBO = glCanvas.createFramebuffer({
      width: 128, height: 128, density: 1, depth: false,
      format: glCanvas.FLOAT, textureFiltering: glCanvas.NEAREST,
    });
    this.yccData = new Float32Array(128 * 128 * 4);
    this.batchData = new Float32Array(SSJ_BATCH * 4);
    this.lineData = new Float32Array(1024 * 4);
    this.srcFBO = null;

    this.state = 'idle';     // 'reading', 'coding', or 'failed' if the worker won't run
    this.field = null;       // settings of the field in flight
    this.readback = new PixelReadback(glCanvas);
    this.results = [];       // decoded fields waiting to be drawn

    this.worker = new Worker(new URL('./slowscanjam/worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => {
      this.results.push(e.data);
      this.state = 'idle';
    };
    this.worker.onerror = (e) => {
      console.error('SlowscanJam worker:', e.message);
      this.state = 'failed';
    };

    this.clock = Infinity;   // start a field on the first frame
    this.lastTime = performance.now() / 1000;
    this.lastClear = 0;
  }

  // One quad per line in a batch. The vertex shader places every quad, so this
  // is built once and never re-uploaded.
  _buildGeometry() {
    const geometry = new p5.Geometry(1, 1, function () {
      for (let q = 0; q < SSJ_BATCH; q++) {
        const base = this.vertices.length;
        this.vertices.push(
          new p5.Vector(-1, -1, q), new p5.Vector(1, -1, q),
          new p5.Vector(1, 1, q), new p5.Vector(-1, 1, q));
        this.faces.push([base, base + 1, base + 2], [base, base + 2, base + 3]);
      }
    });
    // p5 caches a geometry's GPU buffers under its gid (see Development Conventions)
    geometry.gid = `SlowscanJam|${nextGeometryId++}`;
    return geometry;
  }

  // Lines and FPS snap to their steps, so a cable rebuilds the codec only when
  // it crosses one
  _snapped(p) {
    return Math.min(p.max, Math.max(p.min, Math.round(p.value / p.step) * p.step));
  }

  process(graph, glCanvas) {
    const now = performance.now() / 1000;
    const dt = Math.min(Math.max(now - this.lastTime, 0), MAX_DT);
    this.lastTime = now;

    // Every frame, so the knobs' labels follow the Effect drop-down
    this.fx = MENU.resolve(this.params);
    if (this.state === 'reading') this._pollReadback();

    // A field every 1 / fps seconds, as the app's setTimeout paced them, once
    // the last one is through
    const period = 1 / this._snapped(this.params.fps);
    this.clock += dt;
    if (this.clock >= period && this.state === 'idle') {
      this.clock = this.clock - period < period ? this.clock - period : 0;
      const input = this.getInput(graph, 0);
      if (input) this._startField(input, glCanvas);
    }

    this._draw(glCanvas, now * 1000);
  }

  // Shrink the input to the source picture and start reading it back
  _startField(input, glCanvas) {
    const lines = this._snapped(this.params.lines);
    if (!this.srcFBO) {
      this.srcFBO = glCanvas.createFramebuffer({ width: SOURCE_W, height: lines, density: 1, depth: false });
    } else if (this.srcFBO.height !== lines) {
      this.srcFBO.resize(SOURCE_W, lines);
    }
    this.field = {
      lines, fps: this._snapped(this.params.fps), width: glCanvas.width, height: glCanvas.height, srcW: SOURCE_W,
      fx: this.fx, protect: Math.round(this.params.sync.value) === PROTECTED,
    };

    this.srcFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.downShader);
    this.downShader.setUniform('tex0', input);
    this.downShader.setUniform('uStep', [1 / SOURCE_W, 1 / lines]);
    this.renderQuad();
    this.srcFBO.end();

    // SlowscanJam's WebGLEncoder readback. Rows come back top first, as
    // getImageData gave them to the original. WebGL1 reads at once.
    const pixels = this.readback.start(this.srcFBO, SOURCE_W, lines);
    if (pixels) this._code(pixels);
    else this.state = 'reading';
  }

  // Once a frame, until the picture is in
  _pollReadback() {
    const pixels = this.readback.poll();
    if (pixels === false) this.state = 'idle';
    else if (pixels) this._code(pixels);
  }

  _code(pixels) {
    this.worker.postMessage({ ...this.field, pixels }, [pixels.buffer]);
    this.state = 'coding';
  }

  // The decoder's draw(): fade every CLEAR_INTERVAL ms, then draw the new lines
  _draw(glCanvas, nowMs) {
    const fade = nowMs - this.lastClear > CLEAR_INTERVAL;
    if (!fade && this.results.length === 0) return;

    this.outputFBO.begin();
    if (fade) {
      glCanvas.blendMode(glCanvas.BLEND);
      glCanvas.shader(this.fadeShader);
      this.fadeShader.setUniform('uAlpha', FADE_ALPHA);
      this.renderQuad();
      this.lastClear = nowMs;
    }
    for (const result of this.results) this._drawLines(glCanvas, result);
    this.outputFBO.end();
    this.results.length = 0;
  }

  // WebGLPhosphor.drawLines(): pack every line's samples into a row of yccFBO,
  // then draw the lines SSJ_BATCH at a time. A line can run to several thousand
  // samples at low FPS and Lines (see maxColorsPerLine in decoder.js), more than
  // a texture is sure to hold, so one longer than MAX_TEXELS is resampled to
  // that many, still spanning the whole line. That is still about three texels
  // per source pixel.
  _drawLines(glCanvas, { meta, ycc }) {
    const n = meta.length / 4;
    if (n === 0) return;
    let maxCount = 0;
    for (let i = 0; i < n; i++) maxCount = Math.max(maxCount, Math.min(meta[i * 4 + 3], MAX_TEXELS));

    const fbo = this.yccFBO;
    if (maxCount > fbo.width || n > fbo.height) {
      fbo.resize(Math.max(fbo.width, 1 << Math.ceil(Math.log2(maxCount))),
        Math.max(fbo.height, 1 << Math.ceil(Math.log2(n))));
    }
    // Rows are packed at maxCount texels, so only that much uploads
    const rowStride = maxCount * 4;
    if (rowStride * n > this.yccData.length) this.yccData = new Float32Array(rowStride * n);
    if (n * 4 > this.lineData.length) this.lineData = new Float32Array(n * 4);
    const tex = this.yccData;
    const inst = this.lineData;

    let src = 0;   // this line's first sample in ycc
    for (let row = 0; row < n; row++) {
      const count = meta[row * 4 + 3];
      const texels = Math.min(count, MAX_TEXELS);
      if (texels === count) {
        for (let i = 0, s = src * 3, o = row * rowStride; i < count; i++, s += 3, o += 4) {
          tex[o] = ycc[s];
          tex[o + 1] = ycc[s + 1];
          tex[o + 2] = ycc[s + 2];
        }
      } else {
        const step = (count - 1) / (texels - 1);
        for (let j = 0, o = row * rowStride; j < texels; j++, o += 4) {
          const at = j * step;
          const i0 = Math.min(at | 0, count - 2);
          const f = at - i0;
          const s = (src + i0) * 3;
          for (let c = 0; c < 3; c++) tex[o + c] = ycc[s + c] + (ycc[s + 3 + c] - ycc[s + c]) * f;
        }
      }
      src += count;

      // Each line jitters by up to a pixel, for the analog look
      const jx = Math.random() * 2 - 1;
      const jy = Math.random() * 2 - 1;
      const o = row * 4;
      inst[o] = meta[o] + jx;
      inst[o + 1] = meta[o + 1] + jx;
      inst[o + 2] = meta[o + 2] + jy;
      inst[o + 3] = texels - 1;
    }
    this._upload(glCanvas, tex.subarray(0, rowStride * n), maxCount, n);

    glCanvas.blendMode(Math.round(this.params.blend.value) === 1 ? glCanvas.ADD : glCanvas.BLEND);
    glCanvas.noStroke();
    glCanvas.shader(this.lineShader);
    const s = this.lineShader;
    s.setUniform('uRes', [glCanvas.width, glCanvas.height]);
    s.setUniform('uHalfWidth', this.params.lineWidth.value * 0.5);
    s.setUniform('uTexSize', [fbo.width, fbo.height]);
    s.setUniform('uBrightness', this.params.brightness.value);
    s.setUniform('uSaturation', this.params.saturation.value);
    for (let b = 0; b < n; b += SSJ_BATCH) {
      const count = Math.min(SSJ_BATCH, n - b);
      this.batchData.fill(0);
      this.batchData.set(inst.subarray(b * 4, (b + count) * 4));
      // p5 points every sampler at an empty texture after each draw, so this
      // has to be set again for every batch
      s.setUniform('uYcc', fbo);
      s.setUniform('uLines', this.batchData);
      s.setUniform('uCount', count);
      s.setUniform('uRowBase', b);
      glCanvas.model(this.geometry);
    }
    glCanvas.blendMode(glCanvas.BLEND);
  }

  // p5 has no way to fill a texture from an array, so this writes straight into
  // yccFBO's colour texture, putting back the binding and unpack state it touches
  _upload(glCanvas, data, w, h) {
    const gl = glCanvas.drawingContext;
    const fbo = this.yccFBO;
    let pixels = data;
    let type = gl.FLOAT;
    // Without float textures p5 falls back to 8 bits, which clamps the levels
    if (fbo.format === glCanvas.UNSIGNED_BYTE) {
      pixels = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) pixels[i] = Math.max(0, Math.min(255, data[i] * 255 + 0.5));
      type = gl.UNSIGNED_BYTE;
    }
    const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
    const prevFlip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
    const prevPremul = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.bindTexture(gl.TEXTURE_2D, fbo.colorTexture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, type, pixels);
    gl.bindTexture(gl.TEXTURE_2D, prevTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, prevFlip);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, prevPremul);
  }

  dispose() {
    this.worker.terminate();
    this.readback.dispose();
    if (this.geometry) this.glCanvas.freeGeometry(this.geometry);
    if (this.srcFBO) this.srcFBO.remove();
    if (this.yccFBO) this.yccFBO.remove();
    this.geometry = null;
    this.srcFBO = null;
    this.yccFBO = null;
    this.results = [];
    super.dispose();
  }
}

registerModule('SlowscanJam', SlowscanJamModule);
