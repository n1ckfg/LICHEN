import { Module } from './Module.js';
import {
  timetunnelFeedbackFrag, timetunnelBlendFrag, timetunnelLatticeFrag, timetunnelClassicFrag, NOISE_SIZE, BOLTS, BOLT_POINTS,
} from '../shaders/timetunnel.js';
import { vertSrc } from '../shaders/vert.js';
import { registerModule } from '../moduleRegistry.js';

// The tunnel loops exactly every `loop` seconds, as SpiralGalaxy's does: two
// feedback worlds run half a cycle apart, and each restarts from black where
// its blend weight is zero and flat. The walls (the input) don't loop.
const MAX_DT = 0.1;   // clamp long stalls so a tab switch doesn't jump the phase
const TAU = Math.PI * 2;

// The blend shader's sin() hash and value noise, in JS. The bolts, the pit's
// wander and its edge's orbits depend only on the clock, so they are worked out
// here once a frame. Doubles round differently from the GPU's floats, which
// changes which random values come out, not how they are distributed.
const fract = (x) => x - Math.floor(x);
const hash = (x, y) => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);
function noise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
}

export class TimeTunnelModule extends Module {
  static uid = '56551ba1';

  constructor(glCanvas, id) {
    super('TimeTunnel', glCanvas, id);
    this.inputs = [{ id: 'df5e', name: 'in', type: 'video' }];
    this.outputs = [{ id: '4dca', name: 'out', type: 'video' }];
    // `random` ranges keep a fresh seed away from the knobs' degenerate ends: a
    // frozen tunnel at spin 0, trails that smear everything at the top of
    // trail, walls lost in the pit at the top of zoom, and no light on them at
    // light 0.
    // Mode has no `random` key: a seed never changes it. A patch saved before
    // Mode existed loads in the default, Shiny + Classic. Patches save the index, so new modes go on
    // the end.
    this.params = {
      mode: {
        id: '5ade', value: 2, min: 0, max: 2, step: 1, label: 'Mode',
        widget: 'dropdown', valueLabels: ['Shiny', 'Classic', 'Shiny + Classic'],
      },
      zoom: { id: '6a68', value: 3.0, min: 0.5, max: 10, step: 0.1, label: 'Zoom', random: [1.5, 6] },
      speed: { id: '054a', value: 1.0, min: 0.0, max: 5, step: 0.01, label: 'Speed', random: [0.2, 2] },
      loop: { id: 'dc1b', value: 20, min: 5, max: 120, step: 1, label: 'Loop', random: [10, 60] },
      pulses: { id: 'bba1', value: 4, min: 2, max: 16, step: 2, label: 'Pulses', random: [2, 8] },
      spin: { id: '4dd8', value: 0.5, min: 0, max: 3, step: 0.01, label: 'Spin', random: [0.15, 1.5] },
      trail: { id: 'b6b2', value: 0.9, min: 0.7, max: 0.94, step: 0.005, label: 'Trail', random: [0.82, 0.93] },
      warp: { id: '906d', value: 3.5, min: 0, max: 8, step: 0.1, label: 'Warp', random: [0.5, 5] },
      shock: { id: '8963', value: 1, min: 0, max: 2, step: 0.01, label: 'Shock', random: [0.3, 1.6] },
      pit: { id: '16a5', value: 0.185, min: 0, max: 0.4, step: 0.005, label: 'Pit', random: [0.08, 0.28] },
      bolts: { id: 'b579', value: 1, min: 0, max: 2, step: 0.01, label: 'Bolts', random: [0.2, 1.6] },
      rays: { id: '292e', value: 1, min: 0, max: 2, step: 0.01, label: 'Rays', random: [0.3, 1.6] },
      light: { id: '0032', value: 1, min: 0, max: 3, step: 0.01, label: 'Light', random: [0.4, 2] },
      bump: { id: '11b1', value: 1, min: 0, max: 4, step: 0.01, label: 'Bump', random: [0.2, 2.5] },
      shine: { id: '5503', value: 1, min: 0, max: 3, step: 0.01, label: 'Shine', random: [0.2, 2] },
      refract: { id: 'ce07', value: 0.5, min: 0, max: 3, step: 0.01, label: 'Refract', random: [0, 1.5] },
      hue: { id: 'f13d', value: 0, min: 0, max: 6.28, step: 0.01, label: 'Hue', random: true },
      reseed: { id: 'ed45', value: 0, min: 0, max: 1, step: 1, label: 'Seed', widget: 'trigger' },
    };

    this.createShader(timetunnelFeedbackFrag);
    // With nothing cabled in, the module shows the tunnel alone, and the
    // program it uses has no material code to skip.
    this.blendShader = glCanvas.createShader(vertSrc, timetunnelBlendFrag('shiny'));
    this.plainShader = glCanvas.createShader(vertSrc, timetunnelBlendFrag(false));
    // Shiny + Classic: the same light on the original shader's walls.
    this.classicWallShader = glCanvas.createShader(vertSrc, timetunnelBlendFrag('classic'));
    // The original TimeTunnel, which reads only Zoom and Speed.
    this.classicShader = glCanvas.createShader(vertSrc, timetunnelClassicFrag);
    this.createOutputFBO();

    // The feedback pass's noise lattice, filled on the first frame. It has a
    // size of its own, so a frame resize leaves it alone.
    this.latticeShader = glCanvas.createShader(vertSrc, timetunnelLatticeFrag);
    this.lattice = this.createFramebuffer({
      width: NOISE_SIZE, height: NOISE_SIZE, density: 1, textureFiltering: glCanvas.NEAREST,
    });
    this.latticeReady = false;

    // Every new tunnel starts from its own seed. Patch loads and duplicates
    // then restore the saved params and seed over this one.
    this.randomize();

    this.worlds = [this._makeWorld(0.0), this._makeWorld(0.5)];
    this.cycles = 0;
    this.travel = 0;
    this.lastTime = performance.now();
    this.boltArr = new Float32Array(BOLTS * BOLT_POINTS * 2);
  }

  _makeWorld(offset) {
    return {
      offset,
      read: this.createFramebuffer(),
      draw: this.createFramebuffer(),
      age: 0,
      spinT: 0,
      epoch: null,
    };
  }

  _resetWorld(w) {
    for (const fbo of [w.read, w.draw]) {
      fbo.begin();
      this.glCanvas.clear();
      fbo.end();
    }
    w.spinT = w.age * this.params.spin.value;
  }

  _drawFeedback(w, glCanvas, period) {
    w.draw.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('u_prev', w.read);
    this.shader.setUniform('u_noise', this.lattice);
    this.shader.setUniform('uResolution', this.fragResolution());
    this.shader.setUniform('u_age', w.age);
    this.shader.setUniform('u_spinT', w.spinT);
    this.shader.setUniform('u_trail', this.params.trail.value);
    this.shader.setUniform('u_period', period);
    this.shader.setUniform('u_shock', this.params.shock.value);
    this.renderQuad();
    w.draw.end();
  }

  // Everything in the blend pass that depends only on the clock: the pit's
  // wander and edge, and the four bolts' vertices and pulses.
  _clockUniforms(sh, lt) {
    const a = lt * TAU;
    const o1x = Math.cos(a), o1y = Math.sin(a);
    const o2x = Math.cos(a * 2 + 1.7), o2y = Math.sin(a * 2 + 1.7);
    sh.setUniform('u_pitOff', [
      (noise(o1x * 2 + 5.1, o1y * 2 + 1.2) - 0.5) * 0.06 + (noise(o2x * 3 + 9.2, o2y * 3 + 4.4) - 0.5) * 0.04,
      (noise(o1x * 2 + 8.3, o1y * 2 + 2.7) - 0.5) * 0.06 + (noise(o2x * 3 + 3.8, o2y * 3 + 7.1) - 0.5) * 0.04,
    ]);
    sh.setUniform('u_wc1', [Math.cos(a * 2) * 2.0, Math.sin(a * 2) * 2.0]);
    sh.setUniform('u_wc2', [Math.cos(a * 3 + 1.7) * 1.5, Math.sin(a * 3 + 1.7) * 1.5]);
    sh.setUniform('u_wc3', [Math.cos(a * 5 + 2.9) * 1.1, Math.sin(a * 5 + 2.9) * 1.1]);
    sh.setUniform('u_o2', [o2x, o2y]);
    sh.setUniform('u_bloomT', a * 3);
    sh.setUniform('u_rimPulse', 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.cos(a * 4), 2));

    // Each bolt walks out from the centre, meandering on noise
    const pts = this.boltArr;
    const env = [];
    const jitter = a * 2;
    for (let b = 0; b < BOLTS; b++) {
      const seed = hash(b * 7.13, 4.4);
      const len = 0.7 + 0.6 * noise(o1x * 2 + b * 3.1, o1y * 2 + b * 3.1);
      const maxR = (0.10 + hash(seed, 1.7) * 0.12) * len;
      let ang = b * 1.5708 + a * (b * 2 - 3);
      let k = b * BOLT_POINTS * 2;
      pts[k++] = 0;
      pts[k++] = 0;
      for (let i = 0; i < BOLT_POINTS - 1; i++) {
        const f = i / (BOLT_POINTS - 2);
        const r = 0.03 + f * maxR;
        ang += (noise(seed * 5.3 + i * 2.1, jitter) - 0.5) * (0.35 + f * 0.85);
        pts[k++] = Math.cos(ang) * r;
        pts[k++] = Math.sin(ang) * r;
      }
      env.push(Math.pow(0.5 + 0.5 * Math.cos(a * 5 + b * 2.4), 3) * this.params.bolts.value);
    }
    sh.setUniform('u_bolt', pts);
    sh.setUniform('u_boltEnv', env);
  }

  // The original module's process(), with its absolute clock and
  // glCanvas-sized resolution, so Classic draws exactly what it drew. It
  // clears with no input rather than leaving the last frame up.
  _processClassic(graph, glCanvas) {
    const inputFBO = this.getInput(graph, 0);
    const sh = this.classicShader;
    this.outputFBO.begin();
    glCanvas.clear();
    if (inputFBO) {
      glCanvas.shader(sh);
      sh.setUniform('tex0', inputFBO);
      sh.setUniform('time', performance.now() / 1000.0);
      sh.setUniform('uResolution', [glCanvas.width, glCanvas.height]);
      sh.setUniform('zoom', this.params.zoom.value);
      sh.setUniform('speed', this.params.speed.value);
      this.renderQuad();
    }
    this.outputFBO.end();
  }

  process(graph, glCanvas) {
    const p = this.params;
    const mode = Math.round(p.mode.value);
    if (mode === 1) {
      // Shiny's clock stands still meanwhile, so switching back resumes it
      // where it was.
      this.lastTime = performance.now();
      this._processClassic(graph, glCanvas);
      return;
    }
    const loopSecs = p.loop.value;
    const period = loopSecs / p.pulses.value;

    // Accumulated, not read off an absolute clock, so turning Loop, Spin or
    // Speed changes a rate without jumping the picture.
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, MAX_DT);
    this.lastTime = now;
    this.cycles += dt / loopSecs;
    this.travel = (this.travel + dt * p.speed.value) % 2;

    const phase = this.cycles - Math.floor(this.cycles);
    // Weight of world B: 1 at phase 0, 0 at phase 0.5, flat at both
    const mixB = 0.5 + 0.5 * Math.cos(phase * TAU);
    const loopTime = phase * loopSecs;

    if (!this.latticeReady) {
      this.lattice.begin();
      glCanvas.clear();
      glCanvas.shader(this.latticeShader);
      this.renderQuad();
      this.lattice.end();
      this.latticeReady = true;
    }

    for (const w of this.worlds) {
      const u = this.cycles - w.offset;
      const epoch = Math.floor(u);
      w.age = (u - epoch) * loopSecs;
      w.spinT += dt * p.spin.value;
      if (epoch !== w.epoch) { w.epoch = epoch; this._resetWorld(w); }
      this._drawFeedback(w, glCanvas, period);
    }

    const inputFBO = this.getInput(graph, 0);
    const sh = !inputFBO ? this.plainShader : mode === 2 ? this.classicWallShader : this.blendShader;

    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(sh);
    sh.setUniform('tex0', this.worlds[0].draw);
    sh.setUniform('tex1', this.worlds[1].draw);
    sh.setUniform('u_noise', this.lattice);
    sh.setUniform('u_mix', mixB);
    sh.setUniform('uResolution', this.fragResolution());
    sh.setUniform('u_time', loopTime);
    sh.setUniform('u_zt', fract(loopTime / period));
    sh.setUniform('u_warp', p.warp.value);
    sh.setUniform('u_rays', p.rays.value);
    sh.setUniform('u_pit', p.pit.value);
    sh.setUniform('u_flicker', 0.94 + 0.06 * hash(Math.floor(loopTime * 28), 1.7));
    sh.setUniform('u_hueCS', [Math.cos(p.hue.value), Math.sin(p.hue.value)]);
    this._clockUniforms(sh, loopTime / loopSecs);
    if (inputFBO) {
      sh.setUniform('u_in', inputFBO);
      sh.setUniform('u_zoom', p.zoom.value);
      // Classic's walls scroll on the absolute clock, as the original's did.
      sh.setUniform('u_travel', mode === 2 ? performance.now() / 1000 * p.speed.value : this.travel);
      sh.setUniform('u_light', p.light.value);
      sh.setUniform('u_bump', p.bump.value);
      sh.setUniform('u_shine', p.shine.value);
      sh.setUniform('u_refract', p.refract.value);
    }
    this.renderQuad();
    this.outputFBO.end();

    for (const w of this.worlds) { const r = w.read; w.read = w.draw; w.draw = r; }
  }

  onTrigger(name) {
    if (name === 'reseed') this.randomize();
  }

  triggerText(name) {
    return name === 'reseed' ? this.seed : '';
  }

  dispose() {
    for (const w of this.worlds) { w.read = null; w.draw = null; }
    this.worlds = [];
    this.blendShader = null;
    this.plainShader = null;
    this.classicWallShader = null;
    this.classicShader = null;
    this.latticeShader = null;
    this.lattice?.remove();
    this.lattice = null;
    super.dispose();
  }
}

registerModule('TimeTunnel', TimeTunnelModule);
