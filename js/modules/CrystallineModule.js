import { Module } from './Module.js';
import { crystallineFrag } from '../shaders/crystalline.js';
import { passthroughFrag } from '../shaders/passthrough.js';
import { vertSrc } from '../shaders/vert.js';
import { registerModule } from '../moduleRegistry.js';

const MAX_DT = 0.1;   // clamp long stalls so a tab switch doesn't jump the cycle

// Res: the crystal is drawn at the output's size over this, then scaled up
const RES_DIVISORS = [1, 2, 4];

// The cycle, in thirds: assemble, hold, shatter. Assembly and shatter are one
// quantity inverted (see js/shaders/crystalline.js), so this returns the single
// burst amount: 1 at the wrap, eased to 0 by a third, held, eased back to 1.
// Both ramps have zero derivative at their ends, so the loop closes cleanly.
function burstAmount(phase) {
  if (phase < 1 / 3) return 1 - smoothstep01(phase * 3);
  if (phase < 2 / 3) return 0;
  return smoothstep01((phase - 2 / 3) * 3);
}

function smoothstep01(x) {
  return x * x * (3 - 2 * x);
}

export class CrystallineModule extends Module {
  static uid = 'd9943709';

  constructor(glCanvas, id) {
    super('Crystalline', glCanvas, id);
    this.inputs = [];
    this.outputs = [
      { id: '3f57', name: 'out', type: 'video' },
      { id: '173d', name: 'burst', type: 'control' },
    ];
    // `random` ranges keep a fresh seed away from the knobs' degenerate ends
    // (frozen at speed 0, frantic at cycle 5). Steps and Res are a render
    // budget, not a look, so the seed leaves them alone.
    this.params = {
      speed: { id: '74dd', value: 1.0, min: 0, max: 3, step: 0.01, label: 'Speed', random: [0.25, 2] },
      cycle: { id: 'bb33', value: 60, min: 5, max: 180, step: 1, label: 'Cycle', random: [20, 120] },
      scale: { id: 'ac66', value: 2.0, min: 0.5, max: 6, step: 0.05, label: 'Scale', random: [1, 4] },
      burst: { id: '0078', value: 1.0, min: 0, max: 2, step: 0.01, label: 'Burst', random: [0.4, 1.6] },
      dist: { id: '9691', value: 3.0, min: 1.5, max: 8, step: 0.05, label: 'Dist', random: [2, 5] },
      orbit: { id: '5c34', value: 1.0, min: 0, max: 4, step: 0.01, label: 'Orbit', random: [0.25, 2.5] },
      hue: { id: '6cfd', value: 0.55, min: 0, max: 1, step: 0.01, label: 'Hue', random: true },
      glow: { id: 'f847', value: 2.0, min: 0, max: 5, step: 0.05, label: 'Glow', random: [0.5, 3.5] },
      steps: { id: 'd2ea', value: 64, min: 16, max: 80, step: 1, label: 'Steps' },
      res: { id: 'e32b', value: 0, min: 0, max: 2, step: 1, label: 'Res', widget: 'dropdown', valueLabels: ['Full', 'Half', 'Quarter'] },
      reseed: { id: 'cb2f', value: 0, min: 0, max: 1, step: 1, label: 'Seed', widget: 'trigger' },
    };

    this.createShader(crystallineFrag);
    this.createOutputFBO();
    // Half and Quarter draw into lowFBO, made when first needed, and this
    // scales it up into the output
    this.copyShader = glCanvas.createShader(vertSrc, passthroughFrag);
    this.lowFBO = null;

    // Every new crystal starts from its own seed. Patch loads and duplicates
    // then restore the saved params and seed over this one.
    this.randomize();

    // Both clocks are accumulated rather than derived from an absolute time, so
    // turning Speed or Cycle changes the rate without jumping the animation.
    this.time = 0;
    this.cycles = 0;
    this.lastTime = performance.now() / 1000;
  }

  process(graph, glCanvas) {
    const now = performance.now() / 1000;
    const dt = Math.min(now - this.lastTime, MAX_DT);
    this.lastTime = now;

    this.time += dt * this.params.speed.value;
    this.cycles += dt / this.params.cycle.value;

    const shatter = burstAmount(this.cycles - Math.floor(this.cycles));

    const divisor = RES_DIVISORS[Math.round(this.params.res.value)] || 1;
    const target = divisor === 1 ? this.outputFBO : this._lowTarget(divisor);

    target.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    // Only the aspect ratio is read, so the logical size is what this wants
    this.shader.setUniform('uResolution', [glCanvas.width, glCanvas.height]);
    this.shader.setUniform('uTime', this.time);
    this.shader.setUniform('uShatter', shatter);
    this.shader.setUniform('uBurst', this.params.burst.value);
    this.shader.setUniform('uScale', this.params.scale.value);
    this.shader.setUniform('uDist', this.params.dist.value);
    this.shader.setUniform('uOrbit', this.params.orbit.value);
    this.shader.setUniform('uHue', this.params.hue.value);
    this.shader.setUniform('uGlow', this.params.glow.value);
    this.shader.setUniform('uSteps', this.params.steps.value);
    this.renderQuad();
    target.end();

    if (target !== this.outputFBO) {
      // Bilinear, the framebuffer's own filtering
      this.outputFBO.begin();
      glCanvas.clear();
      glCanvas.shader(this.copyShader);
      this.copyShader.setUniform('tex0', target);
      this.renderQuad();
      this.outputFBO.end();
    }

    this.controlValues['burst'] = shatter;
  }

  // The output's physical size over `divisor`, rounded, at density 1. Checked
  // every frame, so it follows a frame resize or a change of Res.
  _lowTarget(divisor) {
    const d = this.outputFBO.density;
    const w = Math.max(1, Math.round(this.glCanvas.width * d / divisor));
    const h = Math.max(1, Math.round(this.glCanvas.height * d / divisor));
    if (!this.lowFBO) {
      this.lowFBO = this.createFramebuffer({ width: w, height: h, density: 1 });
    } else if (this.lowFBO.width !== w || this.lowFBO.height !== h) {
      this.lowFBO.resize(w, h);
    }
    return this.lowFBO;
  }

  dispose() {
    if (this.lowFBO) this.lowFBO.remove();
    this.lowFBO = null;
    this.copyShader = null;
    super.dispose();
  }

  onTrigger(name) {
    if (name === 'reseed') this.randomize();
  }

  triggerText(name) {
    return name === 'reseed' ? this.seed : '';
  }
}

registerModule('Crystalline', CrystallineModule);
