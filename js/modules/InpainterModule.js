import { Module } from './Module.js';
import { vertSrc } from '../shaders/vert.js';
import {
  inpainterFrag, inpainterSeedFrag, inpainterPullFrag, inpainterPushFrag, inpainterSmoothFrag,
} from '../shaders/inpainter.js';
import { registerModule } from '../moduleRegistry.js';

// Fills the input's transparent areas (alpha below Threshold) from the colours
// round them, ported from the Processing Inpainter sketch (Shadertoy 4ty3Dy).
// That shader iterates a Laplacian solve over about 128 frames on a still
// image. This one solves it every frame on a pyramid: each level is pulled
// down from the one below, then, from the top, pushed over the solved level
// above and smoothed with Smooth steps of Jacobi.

export class InpainterModule extends Module {
  static uid = '70b0cc46';

  constructor(glCanvas, id) {
    super('Inpainter', glCanvas, id);
    this.inputs = [{ id: '5bd4', name: 'in', type: 'video' }];
    this.outputs = [{ id: '5c51', name: 'out', type: 'video' }];
    this.params = {
      // Alpha a pixel needs to be kept; anything below it is filled
      threshold: { id: 'be7c', value: 0.5, min: 0.01, max: 1, step: 0.01, label: 'Threshold' },
      // Jacobi steps a level
      smooth: { id: 'd4eb', value: 4, min: 0, max: 32, step: 1, label: 'Smooth' },
      view: {
        id: 'f960', value: 0, min: 0, max: 1, step: 1, label: 'View', widget: 'dropdown',
        valueLabels: ['Inpainted', 'Mask'],
      },
    };
    this.seedShader = glCanvas.createShader(vertSrc, inpainterSeedFrag);
    this.pullShader = glCanvas.createShader(vertSrc, inpainterPullFrag);
    this.pushShader = glCanvas.createShader(vertSrc, inpainterPushFrag);
    this.smoothShader = glCanvas.createShader(vertSrc, inpainterSmoothFrag);
    this.createShader(inpainterFrag);
    this.createOutputFBO();

    // Working buffers by name, at density 1. Half float where it can be drawn
    // to, so colours averaged up and down the pyramid don't band.
    this.targets = new Map();
    this.hasFloat = this._detectFloat(glCanvas);
  }

  _detectFloat(glCanvas) {
    const gl = glCanvas.drawingContext;
    const webgl2 = glCanvas._renderer && glCanvas._renderer.webglVersion === 'webgl2';
    return !!(webgl2 && gl && gl.getExtension &&
      (gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float')));
  }

  // A named working buffer of w x h physical pixels
  _target(name, w, h) {
    let t = this.targets.get(name);
    if (t && t.w === w && t.h === h) return t.fbo;
    if (t) {
      t.fbo.resize(w, h);
    } else {
      const g = this.glCanvas;
      const opts = { width: w, height: h, density: 1, channels: g.RGBA };
      let fbo = null;
      if (this.hasFloat) {
        try {
          fbo = this.createFramebuffer({ format: g.HALF_FLOAT, ...opts });
        } catch (e) {
          this.hasFloat = false;
        }
      }
      t = { fbo: fbo || this.createFramebuffer(opts) };
      this.targets.set(name, t);
    }
    t.w = w;
    t.h = h;
    return t.fbo;
  }

  // One full-screen pass into fbo, under REPLACE so p5's blend can't fold the
  // known weight in alpha into the colour; end() pops the blend mode back
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

  process(graph, glCanvas) {
    const input = this.getInput(graph, 0);
    if (!input) return;
    const threshold = this.params.threshold.value;
    const view = Math.round(this.params.view.value);

    let fill = null;
    if (view === 0) {
      // Level 0 is the frame, and each level above is half the one below,
      // rounded up, to 1 x 1
      const sizes = [this.fragResolution()];
      for (let [w, h] = sizes[0]; w > 1 || h > 1;) {
        w = Math.ceil(w / 2);
        h = Math.ceil(h / 2);
        sizes.push([w, h]);
      }
      const top = sizes.length - 1;
      const pulled = sizes.map(([w, h], k) => this._target(`p${k}`, w, h));

      this._pass(this.seedShader, pulled[0], (s) => {
        s.setUniform('tex0', input);
        s.setUniform('uThreshold', threshold);
      });
      for (let k = 0; k < top; k++) {
        this._pass(this.pullShader, pulled[k + 1], (s) => {
          s.setUniform('tex0', pulled[k]);
          s.setUniform('uFineSize', sizes[k]);
        });
      }

      const steps = Math.max(0, Math.round(this.params.smooth.value));
      let solved = null;
      for (let k = top; k >= 0; k--) {
        const [w, h] = sizes[k];
        let cur = this._target(`a${k}`, w, h);
        let next = this._target(`b${k}`, w, h);
        const coarse = solved;
        this._pass(this.pushShader, cur, (s) => {
          s.setUniform('tex0', pulled[k]);
          // Every sampler is set, so the top level binds itself (see Set every
          // sampler in ARCHITECTURE.md)
          s.setUniform('tex1', coarse || pulled[k]);
          s.setUniform('uSize', sizes[k]);
          s.setUniform('uCoarseSize', coarse ? sizes[k + 1] : sizes[k]);
          s.setUniform('uHasCoarse', coarse ? 1 : 0);
        });
        for (let i = 0, n = Math.min(steps << k, globalThis.__cap ?? 64); i < n; i++) {
          const src = cur;
          this._pass(this.smoothShader, next, (s) => {
            s.setUniform('tex0', pulled[k]);
            s.setUniform('tex1', src);
            s.setUniform('uSize', sizes[k]);
          });
          [cur, next] = [next, cur];
        }
        solved = cur;
      }
      fill = solved;
    }

    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('tex0', input);
    this.shader.setUniform('tex1', fill || input);
    this.shader.setUniform('uThreshold', threshold);
    this.shader.setUniform('uView', view);
    this.renderQuad();
    this.outputFBO.end();
  }

  dispose() {
    for (const t of this.targets.values()) t.fbo.remove();
    this.targets.clear();
    this.seedShader = null;
    this.pullShader = null;
    this.pushShader = null;
    this.smoothShader = null;
    super.dispose();
  }
}

registerModule('Inpainter', InpainterModule);
