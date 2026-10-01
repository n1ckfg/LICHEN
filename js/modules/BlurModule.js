import { Module } from './Module.js';
import { vertSrc } from '../shaders/vert.js';
import {
  blurPrepFrag, blurHalveFrag, blurTentFrag, blurGaussianFrag, blurKawaseDownFrag, blurKawaseUpFrag,
  blurBokehFrag, blurCompositeFrag, BLUR_MAX_PAIRS, BLUR_MAX_BOKEH, BLUR_BOKEH_RIM,
} from '../shaders/blur.js';
import { registerModule } from '../moduleRegistry.js';

// Radius is in pixels of the output, and every mode blurs to the same spread
// (sigma) of radius / 2: a Gaussian of that sigma, a Kawase pyramid measured
// to match, and a Bokeh disc of about that radius (a plain disc's sigma is
// half its radius; the bright rim widens it, so the disc's radius is solved
// from its own sample set). Switching modes changes the character of the
// blur, not its size.

const SCALES = [1, 2, 4, 8, 16, 32];   // working-buffer downscales
const GAUSS_MAX_SIGMA = 12;            // texels a Gaussian may spread before the next scale
// Bokeh samples and the largest disc (texels) they cover at full scale and
// below it. Each count is fixed for its scale: a new count reshuffles the
// whole pattern, which on small highlights flickers as the knob turns.
const BOKEH_FULL = { count: 64, radius: 6 };
const BOKEH_SCALED = { count: BLUR_MAX_BOKEH, radius: 9 };
const BOKEH_BLEND = 0.75;              // share of a scale's range before it starts fading to the next
const EXPAND_MAX = 64;                 // most a highlight's light is multiplied, at Highlights = 1

// Per-axis variance of the bokeh shader's own unit-radius sample set at a
// given count, rim ring and rim weight included: sum(k r^2) / (2 sum(k)).
// Golden-angle turns spread the angles evenly, so each axis takes half.
const bokehVar = [];
function bokehVariance(n) {
  if (bokehVar[n] === undefined) {
    const rim = Math.floor(2 * Math.sqrt(n) + 0.5);
    const inner = Math.sqrt(n - (rim + 1) * 0.5);
    let sk = 0, skr = 0;
    for (let i = 0; i < n; i++) {
      const r = i >= n - rim ? 1 : Math.sqrt(i + 0.5) / inner;
      const k = 1 + BLUR_BOKEH_RIM * r * r;
      sk += k;
      skr += k * r * r;
    }
    bokehVar[n] = skr / (2 * sk);
  }
  return bokehVar[n];
}

// Measured sigma, in physical pixels, of the Kawase result at each pyramid
// depth, including the composite's final upsample (depth 0 is no blur): the
// second moment of a 1-pixel line's response. Roughly doubles per depth.
// Spreads in between are a crossfade of the two depths around them, so the
// blur follows the knob smoothly instead of stepping.
const KAWASE_SIGMA = [0, 1.683, 3.765, 7.721, 15.534, 31.102, 62.222, 122.112];
const KAWASE_LEVELS = KAWASE_SIGMA.length - 1;

export class BlurModule extends Module {
  constructor(glCanvas, id) {
    super('Blur', glCanvas, id);
    this.inputs = [{ name: 'in', type: 'video' }];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      mode: {
        value: 0, min: 0, max: 2, step: 1, label: 'Mode', widget: 'dropdown',
        valueLabels: ['Gaussian', 'Kawase', 'Bokeh'],
      },
      radius: { value: 8, min: 0, max: 100, step: 0.5, label: 'Radius' },
      highlights: { value: 0.25, min: 0, max: 1, step: 0.01, label: 'Highlights' },
      mix: { value: 1, min: 0, max: 1, step: 0.01, label: 'Mix' },
    };

    this.prepShader = glCanvas.createShader(vertSrc, blurPrepFrag);
    this.halveShader = glCanvas.createShader(vertSrc, blurHalveFrag);
    this.tentShader = glCanvas.createShader(vertSrc, blurTentFrag);
    this.gaussianShader = glCanvas.createShader(vertSrc, blurGaussianFrag);
    this.downShader = glCanvas.createShader(vertSrc, blurKawaseDownFrag);
    this.upShader = glCanvas.createShader(vertSrc, blurKawaseUpFrag);
    this.bokehShader = glCanvas.createShader(vertSrc, blurBokehFrag);
    this.createShader(blurCompositeFrag);
    this.createOutputFBO();

    // Working buffers by name, made on first use at whatever scale needs them.
    // Half float keeps the linear-light darks from banding.
    this.targets = new Map();
    this.hasFloat = this._detectFloat(glCanvas);

    this.gaussOffsets = new Float32Array(BLUR_MAX_PAIRS + 1);
    this.gaussWeights = new Float32Array(BLUR_MAX_PAIRS + 1);
    this.gaussPairs = 0;
    this.gaussSigma = -1;
  }

  _detectFloat(glCanvas) {
    const gl = glCanvas.drawingContext;
    const webgl2 = glCanvas._renderer && glCanvas._renderer.webglVersion === 'webgl2';
    return !!(webgl2 && gl && gl.getExtension &&
      (gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float')));
  }

  // A named working buffer of the given physical size: { fbo, w, h }
  _target(name, w, h) {
    let t = this.targets.get(name);
    if (t && t.w === w && t.h === h) return t;
    if (t) {
      t.fbo.resize(w, h);
    } else {
      const g = this.glCanvas;
      const opts = { width: w, height: h, density: 1, channels: g.RGBA, depth: false };
      let fbo = null;
      if (this.hasFloat) {
        try {
          fbo = g.createFramebuffer(Object.assign({ format: g.HALF_FLOAT }, opts));
        } catch (e) {
          this.hasFloat = false;
        }
      }
      t = { fbo: fbo || g.createFramebuffer(opts) };
      this.targets.set(name, t);
    }
    t.w = w;
    t.h = h;
    return t;
  }

  // One full-screen pass into `fbo`. REPLACE so p5's default blend can't fold
  // alpha into the colour of these intermediate values; end() pops the blend
  // mode back.
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

  // A linear, highlight-expanded copy of the input at full resolution, then
  // halved in linear light until it is `scale` times smaller. Returns every
  // buffer on the way, by scale ({ 1: p1, 2: p2, ... }).
  _prep(input, W, H, scale, alpha) {
    let cur = this._target('p1', W, H);
    this._pass(this.prepShader, cur.fbo, sh => {
      sh.setUniform('tex0', input);
      sh.setUniform('u_alpha', alpha);
    });
    const levels = { 1: cur };
    for (let s = 2; s <= scale; s *= 2) {
      const src = cur;
      cur = this._target(`p${s}`, Math.max(1, Math.round(W / s)), Math.max(1, Math.round(H / s)));
      this._pass(this.halveShader, cur.fbo, sh => sh.setUniform('tex0', src.fbo));
      levels[s] = cur;
    }
    return levels;
  }

  // The smallest scale at which a spread `sigma` (output pixels) fits in
  // `limit(s)` texels. Whatever else the pipeline blurs by at scale s comes
  // off the kernel, as variance `extra(s)` in output pixels squared, so the
  // total stays put as the scale steps up. Returns [scale, sigma in texels].
  _pickScale(sigma, limit, extra) {
    let s = 1, inner = sigma;
    for (s of SCALES) {
      inner = this._inner(sigma, s, extra);
      if (inner <= limit(s)) break;
    }
    return [s, inner];
  }

  _inner(sigma, s, extra) {
    return Math.sqrt(Math.max(sigma * sigma - extra(s), 0)) / s;
  }

  // Normalised Gaussian taps, paired so each bilinear fetch covers two texels
  _gaussianTaps(sigma) {
    if (sigma === this.gaussSigma) return;
    this.gaussSigma = sigma;
    const K = Math.min(Math.ceil(sigma * 3), 2 * BLUR_MAX_PAIRS);
    const w = i => (sigma < 1e-3 ? (i === 0 ? 1 : 0) : Math.exp(-0.5 * i * i / (sigma * sigma)));
    let total = w(0);
    for (let i = 1; i <= K; i++) total += 2 * w(i);
    this.gaussOffsets[0] = 0;
    this.gaussWeights[0] = w(0) / total;
    this.gaussPairs = Math.ceil(K / 2);
    for (let p = 1; p <= this.gaussPairs; p++) {
      const i1 = 2 * p - 1, i2 = 2 * p;
      const w1 = w(i1), w2 = i2 <= K ? w(i2) : 0;
      this.gaussWeights[p] = (w1 + w2) / total;
      this.gaussOffsets[p] = w1 + w2 > 0 ? (i1 * w1 + i2 * w2) / (w1 + w2) : i1;
    }
  }

  _gaussian(input, W, H, sigma, alpha) {
    // Box-halving to s, then a bilinear upsample: (s^2 - 1) / 12 + s^2 / 6
    const [s, inner] = this._pickScale(sigma, () => GAUSS_MAX_SIGMA, s => (s > 1 ? (s * s - 1) / 12 + s * s / 6 : 0));
    const A = this._prep(input, W, H, s, alpha)[s];
    const w = A.w, h = A.h;
    const B = this._target(`b${s}`, w, h);
    this._gaussianTaps(inner);
    const axis = (src, dst, step) => this._pass(this.gaussianShader, dst.fbo, sh => {
      sh.setUniform('tex0', src.fbo);
      sh.setUniform('u_step', step);
      sh.setUniform('u_offsets', this.gaussOffsets);
      sh.setUniform('u_weights', this.gaussWeights);
      sh.setUniform('u_pairs', this.gaussPairs);
    });
    axis(A, B, [1 / w, 0]);
    axis(B, A, [0, 1 / h]);
    return { a: A, up: 0 };
  }

  _kawase(input, W, H, sigma, alpha) {
    // Depth L and L + 1 bracket the target spread; the mix of the two is
    // weighted so its variance lands on it exactly
    let L = 0;
    while (L < KAWASE_LEVELS - 1 && KAWASE_SIGMA[L + 1] <= sigma) L++;
    const s0 = KAWASE_SIGMA[L], s1 = KAWASE_SIGMA[L + 1];
    const f = Math.min(Math.max((sigma * sigma - s0 * s0) / (s1 * s1 - s0 * s0), 0), 1);

    const P = this._prep(input, W, H, 1, alpha)[1];
    const levels = [P];
    for (let k = 1; k <= L + 1; k++) {
      const src = levels[k - 1];
      const D = this._target(`d${k}`, Math.max(1, Math.round(W / 2 ** k)), Math.max(1, Math.round(H / 2 ** k)));
      this._pass(this.downShader, D.fbo, sh => {
        sh.setUniform('tex0', src.fbo);
        sh.setUniform('u_texel', [1 / src.w, 1 / src.h]);
      });
      levels.push(D);
    }

    // Upsample from depth n back to level 1; the composite takes the last step
    const chain = (n, tag) => {
      if (n === 0) return { t: P, up: 0 };
      let cur = levels[n];
      for (let k = n - 1; k >= 1; k--) {
        const src = cur;
        const U = this._target(`${tag}${k}`, levels[k].w, levels[k].h);
        this._pass(this.upShader, U.fbo, sh => {
          sh.setUniform('tex0', src.fbo);
          sh.setUniform('u_texel', [1 / src.w, 1 / src.h]);
        });
        cur = U;
      }
      return { t: cur, up: 1 };
    };
    const shallow = chain(L, 'u'), deep = chain(L + 1, 'v');
    return { a: shallow.t, up: shallow.up, b: deep.t, upB: deep.up, ab: f };
  }

  // `sigma` is the spread to match; the disc radius that gives it follows
  // from the sample set's variance. The source is tent-filtered first so small
  // highlights stamp smooth discs, and above full scale the result comes back
  // through a B-spline, which hides the low-res disc's texels.
  //
  // Each step down in scale softens the disc's edge (same spread, different
  // profile), so through the top of a scale's range the result fades toward
  // the next scale's, and is all of it by the time the switch comes.
  _bokeh(input, W, H, sigma, alpha) {
    const cfg = s => (s === 1 ? BOKEH_FULL : BOKEH_SCALED);
    const k = s => Math.sqrt(bokehVariance(cfg(s).count));   // sigma per unit radius
    // Tent (1/2 texel^2), plus above full scale the box-halving and B-spline
    // upsample: (s^2 - 1) / 12 + s^2 / 3
    const extra = s => s * s / 2 + (s > 1 ? (s * s - 1) / 12 + s * s / 3 : 0);
    const [s, inner] = this._pickScale(sigma, s => cfg(s).radius * k(s), extra);
    const top = s < SCALES[SCALES.length - 1];
    const x = (inner / (cfg(s).radius * k(s)) - BOKEH_BLEND) / (1 - BOKEH_BLEND);
    const t = top ? Math.min(Math.max(x, 0), 1) : 0;
    const fade = t * t * (3 - 2 * t);

    const levels = this._prep(input, W, H, fade > 0 ? 2 * s : s, alpha);
    const disc = (sc, innerSigma) => {
      const A = levels[sc], B = this._target(`b${sc}`, A.w, A.h);
      const texel = [1 / A.w, 1 / A.h];
      this._pass(this.tentShader, B.fbo, sh => {
        sh.setUniform('tex0', A.fbo);
        sh.setUniform('u_texel', texel);
      });
      this._pass(this.bokehShader, A.fbo, sh => {
        sh.setUniform('tex0', B.fbo);
        sh.setUniform('u_texel', texel);
        sh.setUniform('u_radius', innerSigma / k(sc));
        sh.setUniform('u_count', cfg(sc).count);
      });
      return A;
    };
    // The next scale's buffer was halved from this one's before either disc
    // pass overwrites it
    const a = disc(s, inner);
    if (fade <= 0) return { a, up: s > 1 ? 2 : 0 };
    const b = disc(2 * s, this._inner(sigma, 2 * s, extra));
    return { a, up: s > 1 ? 2 : 0, b, upB: 2, ab: fade };
  }

  process(graph, glCanvas) {
    const input = this.getInput(graph, 0);
    if (!input) return;
    const [W, H] = this.fragResolution();
    const radius = this.params.radius.value * this.pixelDensity;
    // Highlights is exponential in the expansion (x8 at 0.5, x64 at 1), since
    // what reads as a step up is a multiple of the light, not an increment
    const alpha = 1 - Math.pow(EXPAND_MAX, -this.params.highlights.value);
    const mode = Math.round(this.params.mode.value);

    // Under half a pixel there is nothing to blur: pass straight through
    let r = null;
    if (radius >= 0.5) {
      if (mode === 1) r = this._kawase(input, W, H, radius / 2, alpha);
      else if (mode === 2) r = this._bokeh(input, W, H, radius / 2, alpha);
      else r = this._gaussian(input, W, H, radius / 2, alpha);
    }

    // Unused sources are bound to the input, so every sampler has a texture
    const a = r ? r.a : null, b = r && r.b ? r.b : a;
    this._pass(this.shader, this.outputFBO, sh => {
      sh.setUniform('tex0', input);
      sh.setUniform('u_a', a ? a.fbo : input);
      sh.setUniform('u_b', b ? b.fbo : input);
      sh.setUniform('u_texelA', a ? [1 / a.w, 1 / a.h] : [1 / W, 1 / H]);
      sh.setUniform('u_texelB', b ? [1 / b.w, 1 / b.h] : [1 / W, 1 / H]);
      sh.setUniform('u_upA', r ? r.up : 0);
      sh.setUniform('u_upB', r && r.b ? r.upB : (r ? r.up : 0));
      sh.setUniform('u_ab', r && r.b ? r.ab : 0);
      sh.setUniform('u_mix', r ? this.params.mix.value : 0);
      sh.setUniform('u_alpha', alpha);
    });
  }

  dispose() {
    this.targets.clear();
    this.prepShader = null;
    this.halveShader = null;
    this.tentShader = null;
    this.gaussianShader = null;
    this.downShader = null;
    this.upShader = null;
    this.bokehShader = null;
    super.dispose();
  }
}

registerModule('Blur', BlurModule);
