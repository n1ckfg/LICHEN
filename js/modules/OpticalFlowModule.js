import { Module } from './Module.js';
import { vertSrc } from '../shaders/vert.js';
import { passthroughFrag } from '../shaders/passthrough.js';
import {
  opticalFlowBlurFrag, opticalFlowDownFrag, opticalFlowGradientFrag, opticalFlowLKFrag,
  opticalFlowSmoothFrag, opticalFlowViewFrag,
} from '../shaders/optical-flow.js';
import { registerModule } from '../moduleRegistry.js';

// Dense Lucas-Kanade optical flow on a Gaussian pyramid, ported from
// lk-optical-flow (see OpticalFlow Module in ARCHITECTURE.md). The pyramid is
// always built to MAX_LEVELS, so Levels can change without the previous
// frame's pyramid missing a level.

const VIEWS = ['Color', 'Magnitude', 'Arrows', 'Warp', 'Vectors'];
const MAX_LEVELS = 5;
const ZERO8 = 128 / 255;

export class OpticalFlowModule extends Module {
  static uid = '63c8b4de';

  constructor(glCanvas, id) {
    super('OpticalFlow', glCanvas, id);
    this.inputs = [{ id: 'b005', name: 'in', type: 'video' }];
    this.outputs = [{ id: 'bb68', name: 'out', type: 'video' }];
    this.params = {
      view: {
        id: '7230', value: 2, min: 0, max: VIEWS.length - 1, step: 1, label: 'View',
        widget: 'dropdown', valueLabels: VIEWS,
      },
      levels: { id: '1ef0', value: 4, min: 1, max: MAX_LEVELS, step: 1, label: 'Levels' },
      window: { id: '79b7', value: 9, min: 3, max: 15, step: 2, label: 'Window' },
      range: { id: 'dd1c', value: 15, min: 1, max: 100, step: 0.5, label: 'Range' },
      spacing: { id: '08c4', value: 16, min: 8, max: 64, step: 1, label: 'Spacing' },
      // Grey levels a texel the window's luma must change by, in its flattest
      // direction, for the window's motion to be solved
      texture: { id: '86ad', value: 0.5, min: 0, max: 8, step: 0.05, label: 'Texture' },
      iterations: { id: 'd558', value: 2, min: 1, max: 5, step: 1, label: 'Iterations' },
      smooth: { id: 'e596', value: 0, min: 0, max: 0.99, step: 0.01, label: 'Smooth' },
    };

    this.blurShader = glCanvas.createShader(vertSrc, opticalFlowBlurFrag);
    this.downShader = glCanvas.createShader(vertSrc, opticalFlowDownFrag);
    this.gradientShader = glCanvas.createShader(vertSrc, opticalFlowGradientFrag);
    this.lkShader = glCanvas.createShader(vertSrc, opticalFlowLKFrag);
    this.smoothShader = glCanvas.createShader(vertSrc, opticalFlowSmoothFrag);
    this.copyShader = glCanvas.createShader(vertSrc, passthroughFrag);
    this.createShader(opticalFlowViewFrag);
    this.createOutputFBO();

    // The previous input, for Warp; it follows the frame like the output
    this.prevColor = this.createFramebuffer();

    // Working buffers, at density 1 and the logical frame size at level 0.
    // Half float where it can be drawn to, else 8 bits with signed values
    // offset to 128 (see the encoding in optical-flow.js).
    this.hasFloat = this._detectFloat(glCanvas);
    this.sizes = null;
    this.buffers = [];
    this._allocate();
  }

  _detectFloat(glCanvas) {
    const gl = glCanvas.drawingContext;
    const webgl2 = glCanvas._renderer && glCanvas._renderer.webglVersion === 'webgl2';
    if (!(webgl2 && gl && gl.getExtension &&
      (gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float')))) {
      return false;
    }
    try {
      this.createFramebuffer({ width: 1, height: 1, density: 1, format: glCanvas.HALF_FLOAT }).remove();
      return true;
    } catch (e) {
      return false;
    }
  }

  _buffer(w, h) {
    const g = this.glCanvas;
    const opts = { width: w, height: h, density: 1, channels: g.RGBA };
    if (this.hasFloat) opts.format = g.HALF_FLOAT;
    const fbo = this.createFramebuffer(opts);
    this.buffers.push(fbo);
    return fbo;
  }

  // Level 0 is the logical frame, and each level after it half the last
  _levelSizes() {
    const sizes = [[Math.max(1, Math.round(this.glCanvas.width)), Math.max(1, Math.round(this.glCanvas.height))]];
    for (let i = 1; i < MAX_LEVELS; i++) {
      const [w, h] = sizes[i - 1];
      sizes.push([Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2))]);
    }
    return sizes;
  }

  // (Re)make every working buffer for the current frame size, and start the
  // history over
  _allocate() {
    for (const fbo of this.buffers) fbo.remove();
    this.buffers = [];
    this.sizes = this._levelSizes();
    const [w0, h0] = this.sizes[0];
    this.temp = this._buffer(w0, h0);
    this.pyramids = [0, 1].map(() => this.sizes.map(([w, h]) => this._buffer(w, h)));
    this.grads = this.sizes.map(([w, h]) => this._buffer(w, h));
    // Two a level, since each iteration reads the last one's flow
    this.flows = [0, 1].map(() => this.sizes.map(([w, h]) => this._buffer(w, h)));
    this.smoothed = [this._buffer(w0, h0), this._buffer(w0, h0)];
    this.current = 0;     // which pyramid and smoothed buffer this frame writes
    this.hasHistory = false;
  }

  frameResized() {
    this._allocate();
  }

  // One full-screen pass into fbo. REPLACE so p5's blend can't fold alpha
  // into encoded values; end() pops the blend mode back.
  _pass(shader, fbo, setup) {
    const g = this.glCanvas;
    fbo.begin();
    g.clear();
    g.blendMode(g.REPLACE);
    g.shader(shader);
    setup(shader);
    this.renderQuad();
    fbo.end();
  }

  _setEncoding(sh) {
    if (this.hasFloat) {
      sh.setUniform('uGradEnc', [1, 0]);
      sh.setUniform('uFlowEnc', [1, 0]);
    } else {
      // Central differences of luma run -0.5..0.5
      sh.setUniform('uGradEnc', [1, ZERO8]);
      sh.setUniform('uFlowEnc', [0.01, ZERO8]);
    }
  }

  // Luma, blurred, at level 0, then halved down the pyramid
  _buildPyramid(input, pyr) {
    const [w0, h0] = this.sizes[0];
    this._pass(this.blurShader, this.temp, sh => {
      sh.setUniform('tex0', input);
      sh.setUniform('uStep', [1 / w0, 0]);
      sh.setUniform('uLuma', 1);
    });
    this._pass(this.blurShader, pyr[0], sh => {
      sh.setUniform('tex0', this.temp);
      sh.setUniform('uStep', [0, 1 / h0]);
      sh.setUniform('uLuma', 0);
    });
    for (let i = 1; i < MAX_LEVELS; i++) {
      const [sw, sh0] = this.sizes[i - 1];
      this._pass(this.downShader, pyr[i], sh => {
        sh.setUniform('tex0', pyr[i - 1]);
        sh.setUniform('uTexel', [1 / sw, 1 / sh0]);
      });
    }
  }

  process(graph, glCanvas) {
    const input = this.getInput(graph, 0);
    if (!input) return;

    const [w0, h0] = this._levelSizes()[0];
    if (w0 !== this.sizes[0][0] || h0 !== this.sizes[0][1]) this._allocate();

    const cur = this.pyramids[this.current];
    // With no previous frame, compare this one with itself: no motion
    const prev = this.hasHistory ? this.pyramids[1 - this.current] : cur;
    this._buildPyramid(input, cur);

    const levels = Math.max(1, Math.min(MAX_LEVELS, Math.round(this.params.levels.value)));
    const iterations = Math.max(1, Math.min(5, Math.round(this.params.iterations.value)));
    const half = Math.max(1, Math.min(7, Math.floor(Math.round(this.params.window.value) / 2)));
    const texture = Math.max(0, this.params.texture.value) / 255;

    // Coarse to fine. Each level starts from the coarser level's flow, scaled
    // to its own texels, and each step after the first from the last step's.
    let flow = null;
    for (let lvl = levels - 1; lvl >= 0; lvl--) {
      const [w, h] = this.sizes[lvl];
      const texel = [1 / w, 1 / h];
      const maxFlow = this.hasFloat ? Math.max(w, h) / 4 : 50;
      this._pass(this.gradientShader, this.grads[lvl], sh => {
        this._setEncoding(sh);
        sh.setUniform('tex0', cur[lvl]);
        sh.setUniform('uTexel', texel);
      });
      for (let it = 0; it < iterations; it++) {
        const prior = flow;
        const ratio = prior && it === 0
          ? [w / this.sizes[lvl + 1][0], h / this.sizes[lvl + 1][1]] : [1, 1];
        flow = this.flows[it % 2][lvl];
        this._pass(this.lkShader, flow, sh => {
          this._setEncoding(sh);
          sh.setUniform('tex0', this.grads[lvl]);
          sh.setUniform('tex1', prev[lvl]);
          // With no prior yet the sampler still gets a texture
          sh.setUniform('uPrior', prior || cur[lvl]);
          sh.setUniform('uHasPrior', prior ? 1 : 0);
          sh.setUniform('uRatio', ratio);
          sh.setUniform('uTexel', texel);
          sh.setUniform('uHalf', half);
          sh.setUniform('uMaxFlow', maxFlow);
          sh.setUniform('uMinEigen', texture * texture);
        });
      }
    }

    const out = this.smoothed[this.current];
    const last = this.hasHistory ? this.smoothed[1 - this.current] : flow;
    this._pass(this.smoothShader, out, sh => {
      this._setEncoding(sh);
      sh.setUniform('tex0', flow);
      sh.setUniform('tex1', last);
      sh.setUniform('uSmooth', this.hasHistory ? Math.max(0, Math.min(0.99, this.params.smooth.value)) : 0);
    });

    this._pass(this.shader, this.outputFBO, sh => {
      this._setEncoding(sh);
      sh.setUniform('tex0', input);
      sh.setUniform('tex1', this.hasHistory ? this.prevColor : input);
      sh.setUniform('uFlow', out);
      sh.setUniform('uSize', [glCanvas.width, glCanvas.height]);
      sh.setUniform('uDensity', this.pixelDensity);
      sh.setUniform('uView', Math.round(this.params.view.value));
      sh.setUniform('uRange', Math.max(this.params.range.value, 1e-3));
      sh.setUniform('uSpacing', Math.max(this.params.spacing.value, 1));
    });

    this._pass(this.copyShader, this.prevColor, sh => sh.setUniform('tex0', input));

    this.current = 1 - this.current;
    this.hasHistory = true;
  }

  dispose() {
    for (const fbo of this.buffers) fbo.remove();
    this.buffers = [];
    this.prevColor.remove();
    this.prevColor = null;
    this.blurShader = null;
    this.downShader = null;
    this.gradientShader = null;
    this.lkShader = null;
    this.smoothShader = null;
    this.copyShader = null;
    super.dispose();
  }
}

registerModule('OpticalFlow', OpticalFlowModule);
