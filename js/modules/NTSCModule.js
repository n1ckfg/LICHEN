// SPDX-License-Identifier: AGPL-3.0-or-later
//
// NTSC composite video and VHS, ported from ntsc-wasm by noxylva
// (https://github.com/Nedifinita/ntsc-wasm) to fragment shaders. Like
// js/shaders/ntsc.js and js/modules/ntsc/ring-pattern.js, this file is under
// the GNU Affero General Public License v3 or later, as ntsc-wasm is; the
// rest of LICHEN is GPL v3 or later, which may be combined with it (GPL v3
// section 13). See NTSC Module in ARCHITECTURE.md.

import { Module } from './Module.js';
import { vertSrc } from '../shaders/vert.js';
import { passthroughFrag } from '../shaders/passthrough.js';
import {
  ntscLinesFrag, ntscEncodeFrag, ntscLowpassFrag, ntscBoostFrag, ntscRingSimpleFrag,
  ntscRingPatternFrag, ntscModulateFrag, ntscNoiseFrag, ntscDecodeFrag, ntscRgbFrag, NTSC_RING_TAPS,
} from '../shaders/ntsc.js';
import { RING_PATTERN } from './ntsc/ring-pattern.js';
import { registerModule } from '../moduleRegistry.js';

// Four times the colour subcarrier: a raster sample's rate
const NTSC_RATE = 315000000 / 88 * 4;
// Lines in the raster, as ntsc-wasm's head switching assumes
const LINES = 480;
const MAX_SAMPLES = 2048;
const MAX_TAPS = 160;     // as in the shaders

const TAPES = ['Off', 'SP', 'LP', 'EP'];
// Luma and chroma cut-offs (Hz) and the chroma delay (samples) of each speed
const TAPE_SPEEDS = [null, [2400000, 320000, 9], [1900000, 300000, 12], [1400000, 280000, 14]];
const PHASES = ['0°', '90°', '180°', '270°'];

// ntsc-wasm's head switching point and phase, as fractions of a field
const HEAD_POINT = 1 - (4.5 + 0.01) / 262.5;
const HEAD_PHASE = (1 - 0.01) / 262.5;
const HEAD_NOISE = 1 / 500 / 262.5;

// A one-pole low-pass's coefficient at cut-off hz, as ntsc-wasm's LowpassFilter
function alpha(hz) {
  const dt = 1 / NTSC_RATE;
  const tau = 1 / (hz * 2 * Math.PI);
  return dt / (tau + dt);
}

// Taps until a low-pass of `order` one-pole stages has all but 1e-4 of its
// response, the rest being treated as the reset level
function taps(a, order) {
  let sum = 0, q = 1;
  for (let k = 0; k <= MAX_TAPS; k++) {
    sum += order === 1 ? a * q : a * a * a * 0.5 * (k + 1) * (k + 2) * q;
    if (sum >= 1 - 1e-4) return k;
    q *= 1 - a;
  }
  return MAX_TAPS;
}

export class NTSCModule extends Module {
  static uid = 'e2ac1122';

  constructor(glCanvas, id) {
    super('NTSC', glCanvas, id);
    this.inputs = [{ id: '7359', name: 'in', type: 'video' }];
    this.outputs = [{ id: '01f4', name: 'out', type: 'video' }];
    this.params = {
      tape: {
        id: 'aece', value: 0, min: 0, max: TAPES.length - 1, step: 1, label: 'Tape',
        widget: 'dropdown', valueLabels: TAPES, random: true,
      },
      subcarrier: { id: 'beb1', value: 50, min: 0, max: 100, step: 1, label: 'Subcarrier', random: [30, 80] },
      phase: {
        id: 'ddf9', value: 2, min: 0, max: PHASES.length - 1, step: 1, label: 'Phase',
        widget: 'dropdown', valueLabels: PHASES, random: true,
      },
      crawl: {
        id: 'b5bb', value: 1, min: 0, max: 1, step: 1, label: 'Crawl', widget: 'dropdown', valueLabels: ['Off', 'On'],
      },
      color: {
        id: 'c633', value: 1, min: 0, max: 1, step: 1, label: 'Set', widget: 'dropdown', valueLabels: ['Mono', 'Color'],
      },
      preemphasis: { id: '7f17', value: 0, min: 0, max: 8, step: 0.1, label: 'Preemph', random: [0, 4] },
      ringing: { id: 'af2a', value: 1, min: 0, max: 3, step: 0.1, label: 'Ringing', random: [0.3, 1.7] },
      pattern: {
        id: '8d8d', value: 0, min: 0, max: 5, step: 1, label: 'Pattern', valueLabels: ['Off', '1', '2', '3', '4', '5'],
        random: true,
      },
      bleedH: { id: '8a72', value: 0, min: 0, max: 20, step: 1, label: 'Bleed X', random: [0, 6] },
      bleedV: { id: 'c7d3', value: 0, min: 0, max: 20, step: 1, label: 'Bleed Y', random: [0, 2] },
      noise: { id: '1696', value: 2, min: 0, max: 100, step: 1, label: 'Noise', random: [0, 30] },
      chromaNoise: { id: '5a70', value: 0, min: 0, max: 500, step: 1, label: 'Chroma Noise', random: [0, 100] },
      phaseNoise: { id: '0f1f', value: 0, min: 0, max: 100, step: 1, label: 'Phase Noise', random: [0, 30] },
      // Percent of lines; ntsc-wasm counts in lines per 100000
      chromaLoss: { id: 'afde', value: 0, min: 0, max: 100, step: 0.1, label: 'Chroma Loss', random: [0, 5] },
      sharpen: { id: 'd43a', value: 1.5, min: 0, max: 5, step: 0.1, label: 'Sharpen', random: [0.5, 3] },
      edgeWave: { id: '09d8', value: 0, min: 0, max: 10, step: 1, label: 'Edge Wave', random: [0, 4] },
      headSwitch: {
        id: '809c', value: 0, min: 0, max: 1, step: 1, label: 'Head Switch', widget: 'dropdown',
        valueLabels: ['Off', 'On'], random: true,
      },
      reseed: { id: '668c', value: 0, min: 0, max: 1, step: 1, label: 'Seed', widget: 'trigger' },
    };

    const sh = (frag) => glCanvas.createShader(vertSrc, frag);
    this.linesShader = sh(ntscLinesFrag);
    this.encodeShader = sh(ntscEncodeFrag);
    this.lowpassShader = sh(ntscLowpassFrag);
    this.boostShader = sh(ntscBoostFrag);
    this.ringSimpleShader = sh(ntscRingSimpleFrag);
    this.ringPatternShader = sh(ntscRingPatternFrag);
    this.modulateShader = sh(ntscModulateFrag);
    this.noiseShader = sh(ntscNoiseFrag);
    this.decodeShader = sh(ntscDecodeFrag);
    this.rgbShader = sh(ntscRgbFrag);
    this.copyShader = sh(passthroughFrag);
    this.createOutputFBO();

    this.format = this._detectFormat(glCanvas);
    if (!this.format) console.warn('NTSC: no float framebuffers here, so the input passes through');
    this.buffers = [];
    this.size = null;
    this.frame = 0;
    this.salt = Math.random() * 100;
    this.kernelKey = null;
    this.kernel = new Float32Array(196);
  }

  // FLOAT where it can be drawn to, else HALF_FLOAT, else nothing
  _detectFormat(g) {
    const gl = g.drawingContext;
    const webgl2 = g._renderer && g._renderer.webglVersion === 'webgl2';
    if (!(webgl2 && gl && gl.getExtension)) return null;
    const tries = [];
    if (gl.getExtension('EXT_color_buffer_float')) tries.push(g.FLOAT, g.HALF_FLOAT);
    else if (gl.getExtension('EXT_color_buffer_half_float')) tries.push(g.HALF_FLOAT);
    for (const format of tries) {
      try {
        this.createFramebuffer({ width: 1, height: 1, density: 1, format, textureFiltering: g.NEAREST }).remove();
        return format;
      } catch (e) {
        // try the next
      }
    }
    return null;
  }

  // The raster: 480 lines, and samples enough to keep the frame's shape
  _rasterSize() {
    const g = this.glCanvas;
    const w = Math.round(LINES * g.width / Math.max(1, g.height));
    return [Math.max(16, Math.min(MAX_SAMPLES, w)), LINES];
  }

  _allocate([w, h]) {
    for (const fbo of this.buffers) fbo.remove();
    const g = this.glCanvas;
    const float = { density: 1, channels: g.RGBA, format: this.format, textureFiltering: g.NEAREST };
    this.ping = [0, 1].map(() => this.createFramebuffer({ width: w, height: h, ...float }));
    this.lines = this.createFramebuffer({ width: 1, height: h, ...float });
    // The picture in 8 bits, for a smooth scale to the output
    this.rgb = this.createFramebuffer({ width: w, height: h, density: 1 });
    this.buffers = [...this.ping, this.lines, this.rgb];
    this.size = [w, h];
  }

  frameResized() {
    this.size = null;
  }

  onTrigger(name) {
    if (name === 'reseed') this.randomize();
  }

  triggerText(name) {
    return name === 'reseed' ? (this.seed ?? '') : '';
  }

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

  // The ring pattern's filter as a convolution kernel: the real part of the
  // inverse DFT of the pattern, stretched over the line's spectrum with DC in
  // the middle and raised to `power`, kept to NTSC_RING_TAPS either side and
  // scaled so the taps keep DC
  _ringKernel(w, power) {
    const key = `${w}|${power}`;
    if (key === this.kernelKey) return this.kernel;
    const R = NTSC_RING_TAPS;
    const c = Math.floor(w / 2);
    const mask = new Float64Array(w);
    for (let i = 0; i < w; i++) {
      mask[i] = Math.pow(RING_PATTERN[Math.min(RING_PATTERN.length - 1, Math.floor(i / w * RING_PATTERN.length))], power);
    }
    const k = new Float32Array(196);
    let sum = 0;
    for (let n = -R; n <= R; n++) {
      let s = 0;
      for (let i = 0; i < w; i++) s += mask[i] * Math.cos(2 * Math.PI * (i - c) * n / w);
      k[n + R] = s / w;
      sum += s / w;
    }
    for (let j = 0; j <= 2 * R; j++) k[j] /= sum;
    this.kernel = k;
    this.kernelKey = key;
    return k;
  }

  // Where head switching starts in each field this frame, after
  // ntsc-wasm's vhsHeadSwitching: [start line, first shift] a field
  _headSwitch(w) {
    const tw = w + Math.floor(w / 10);
    const t = tw * 262.5;
    const out = [];
    for (let f = 0; f < 2; f++) {
      const noise = (Math.random() * 2 - 1) * HEAD_NOISE;
      const point = Math.floor((((HEAD_POINT + noise) % 1) + 1) % 1 * t);
      let y = Math.floor(point / tw * 2) - (262 - 240) * 2;
      // ntsc-wasm adds the field to this line; here it is kept on its field
      y = 2 * Math.floor(y / 2) + f;
      const x = Math.floor((((HEAD_PHASE + noise) % 1) + 1) % 1 * t) % tw;
      const shift = x < tw / 2 ? x : x - Math.floor(tw / 2);
      out.push([y, shift]);
    }
    return out;
  }

  process(graph, glCanvas) {
    const input = this.getInput(graph, 0);
    if (!input) return;
    if (!this.format) {
      this._pass(this.copyShader, this.outputFBO, s => s.setUniform('tex0', input));
      return;
    }
    const size = this._rasterSize();
    if (!this.size || size[0] !== this.size[0] || size[1] !== this.size[1]) this._allocate(size);
    const [W, H] = this.size;
    const p = this.params;
    const val = name => p[name].value;
    const tape = TAPE_SPEEDS[Math.round(val('tape'))] || null;
    const seed = (this.frame % 8192) * 0.618034 + this.salt;
    const amp = Math.max(0, val('subcarrier'));
    const phase = Math.max(0, Math.min(3, Math.round(val('phase'))));
    const offset = val('crawl') >= 0.5 ? (this.frame % 2) * 2 : 0;

    // Ping-pong: each step reads the last result and writes the other buffer
    let cur = 0;
    const step = (shader, setup) => {
      const src = this.ping[cur];
      cur = 1 - cur;
      this._pass(shader, this.ping[cur], s => {
        s.setUniform('uSize', [W, H]);
        s.setUniform('uSeed', seed);
        s.setUniform('tex0', src);
        setup(s);
      });
    };
    const lowpass = (a, d, r, extra = {}) => step(this.lowpassShader, s => {
      s.setUniform('uLinesTex', this.lines);
      s.setUniform('uAlpha', a);
      s.setUniform('uDelay', d);
      s.setUniform('uReset', r);
      s.setUniform('uTaps', a.map(x => (x > 0 ? taps(x, 3) : 0)));
      s.setUniform('uEdge', extra.edge ? 1 : 0);
      s.setUniform('uLoss', extra.loss ? 1 : 0);
    });
    const boost = (order, a, reset, gain, vblend = 0) => step(this.boostShader, s => {
      s.setUniform('uOrder', order);
      s.setUniform('uAlpha', a);
      s.setUniform('uReset', reset);
      s.setUniform('uTaps', taps(a, order));
      s.setUniform('uGain', gain);
      s.setUniform('uVBlend', vblend);
    });
    const modulate = () => step(this.modulateShader, s => {
      s.setUniform('uAmp', amp);
      s.setUniform('uPhase', phase);
      s.setUniform('uOffset', offset);
    });
    const decode = (noisy) => step(this.decodeShader, s => {
      s.setUniform('uLinesTex', this.lines);
      s.setUniform('uAmp', amp);
      s.setUniform('uPhase', phase);
      s.setUniform('uOffset', offset);
      s.setUniform('uDecode', val('color') >= 0.5 ? 1 : 0);
      s.setUniform('uChromaNoise', noisy ? Math.max(0, val('chromaNoise')) : 0);
      s.setUniform('uPhaseOn', noisy && val('phaseNoise') > 0 ? 1 : 0);
    });

    // What each line does this frame
    const head = this._headSwitch(W);
    this._pass(this.linesShader, this.lines, s => {
      s.setUniform('uLines', H);
      s.setUniform('uSeed', seed);
      s.setUniform('uEdgeWave', tape ? Math.max(0, Math.round(val('edgeWave'))) : 0);
      s.setUniform('uEdgeAlpha', alpha(tape ? tape[0] : 2400000));
      s.setUniform('uPhaseNoise', Math.max(0, val('phaseNoise')));
      s.setUniform('uLoss', Math.max(0, val('chromaLoss')) / 100);
      s.setUniform('uHead', val('headSwitch') >= 0.5 ? 1 : 0);
      s.setUniform('uHeadStart', [head[0][0], head[1][0]]);
      s.setUniform('uHeadShift', [head[0][1], head[1][1]]);
    });

    // RGB to YIQ, with colour bleed
    this._pass(this.encodeShader, this.ping[0], s => {
      s.setUniform('tex0', input);
      s.setUniform('uSize', [W, H]);
      s.setUniform('uBleed', [Math.round(val('bleedH')), Math.round(val('bleedV'))]);
    });
    cur = 0;

    // The encoder's chroma band limits: I to 1.3 MHz, Q to 0.6 MHz
    lowpass([0, alpha(1300000), alpha(600000)], [0, 2, 4], [0, 0, 0]);

    const pattern = Math.round(val('pattern'));
    if (pattern > 0) {
      const k = this._ringKernel(W, pattern);
      step(this.ringPatternShader, s => s.setUniform('uKernel', Array.from(k)));
    } else if (val('ringing') !== 1) {
      step(this.ringSimpleShader, s => s.setUniform('uRinging', val('ringing')));
    }

    modulate();
    if (val('preemphasis') !== 0) boost(1, alpha(1000000), 16, val('preemphasis'));
    step(this.noiseShader, s => {
      s.setUniform('uLinesTex', this.lines);
      s.setUniform('uNoise', Math.max(0, Math.round(val('noise'))));
    });
    decode(true);

    if (tape) {
      const [lumaCut, chromaCut, chromaDelay] = tape;
      // Edge wave, then the tape's luma and chroma band limits
      lowpass([alpha(lumaCut), alpha(chromaCut), alpha(chromaCut)], [0, chromaDelay, chromaDelay], [16, 0, 0],
        { edge: true });
      // The luma's peaking, and the chroma comb's line delay
      boost(1, alpha(lumaCut), 16, 1.6, 1);
      boost(3, alpha(lumaCut * 4), 0, val('sharpen') * 2);
      // Composite out of the deck and into the set again
      modulate();
      decode(false);
    }

    // The set's chroma low-pass, with lost lines
    lowpass([0, alpha(2600000), alpha(2600000)], [0, 1, 1], [0, 0, 0], { loss: true });

    this._pass(this.rgbShader, this.rgb, s => {
      s.setUniform('tex0', this.ping[cur]);
      s.setUniform('uSize', [W, H]);
      s.setUniform('uSeed', seed);
    });
    this._pass(this.copyShader, this.outputFBO, s => s.setUniform('tex0', this.rgb));

    this.frame++;
  }

  dispose() {
    for (const fbo of this.buffers) fbo.remove();
    this.buffers = [];
    for (const name of ['linesShader', 'encodeShader', 'lowpassShader', 'boostShader', 'ringSimpleShader',
      'ringPatternShader', 'modulateShader', 'noiseShader', 'decodeShader', 'rgbShader', 'copyShader']) {
      this[name] = null;
    }
    super.dispose();
  }
}

registerModule('NTSC', NTSCModule);
