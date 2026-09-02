import { Module } from './Module.js';
import { crystallineFrag } from '../shaders/crystalline.js';
import { registerModule } from '../moduleRegistry.js';

const MAX_DT = 0.1;   // clamp long stalls so a tab switch doesn't jump the cycle

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
  constructor(glCanvas, id) {
    super('Crystalline', glCanvas, id);
    this.inputs = [];
    this.outputs = [
      { name: 'out', type: 'video' },
      { name: 'burst', type: 'control' },
    ];
    this.params = {
      speed: { value: 1.0, min: 0, max: 3, step: 0.01, label: 'Speed' },
      cycle: { value: 60, min: 5, max: 180, step: 1, label: 'Cycle' },
      scale: { value: 2.0, min: 0.5, max: 6, step: 0.05, label: 'Scale' },
      burst: { value: 1.0, min: 0, max: 2, step: 0.01, label: 'Burst' },
      dist: { value: 3.0, min: 1.5, max: 8, step: 0.05, label: 'Dist' },
      orbit: { value: 1.0, min: 0, max: 4, step: 0.01, label: 'Orbit' },
      hue: { value: 0.55, min: 0, max: 1, step: 0.01, label: 'Hue' },
      glow: { value: 2.0, min: 0, max: 5, step: 0.05, label: 'Glow' },
      steps: { value: 64, min: 16, max: 80, step: 1, label: 'Steps' },
    };

    this.createShader(crystallineFrag);
    this.createOutputFBO();

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

    this.outputFBO.begin();
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
    this.outputFBO.end();

    this.controlValues['burst'] = shatter;
  }
}

registerModule('Crystalline', CrystallineModule);
