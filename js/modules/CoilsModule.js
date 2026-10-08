import { Module } from './Module.js';
import { coilsFrag } from '../shaders/coils.js';
import { registerModule } from '../moduleRegistry.js';

const MAX_DT = 0.1;          // clamp long stalls so a tab switch doesn't jump the clock
const ORBIT_RATE = 0.25;     // the sketch's camera orbit, radians per second
const TAU = Math.PI * 2;

export class CoilsModule extends Module {
  static uid = 'db648f5a';

  constructor(glCanvas, id) {
    super('Coils', glCanvas, id);
    this.inputs = [];
    this.outputs = [{ id: 'e78c', name: 'out', type: 'video' }];
    // Defaults are the sketch's constants. `random` ranges keep a fresh seed
    // away from the knobs' degenerate ends: frozen at speed 0, nearly straight
    // at 1 turn, and a coil wound so tight, wide or thin that the march tears it
    // down to a few threads (see js/shaders/coils.js). Step and Steps are the
    // march itself rather than the coil, so the seed leaves them alone.
    this.params = {
      speed: { id: '1307', value: 1.0, min: 0, max: 3, step: 0.01, label: 'Speed', random: [0.25, 2] },
      turns: { id: '3841', value: 5, min: 1, max: 12, step: 0.1, label: 'Turns', random: [2, 6] },
      radius: { id: 'ee29', value: 1.1, min: 0.2, max: 2.5, step: 0.01, label: 'Radius', random: [0.6, 1.6] },
      thick: { id: '0b60', value: 0.28, min: 0.05, max: 0.8, step: 0.01, label: 'Tube', random: [0.2, 0.45] },
      lobes: { id: 'cff8', value: 1.0, min: 0, max: 3, step: 0.01, label: 'Lobes', random: [0, 2] },
      bulge: { id: '7c3a', value: 0.06, min: 0, max: 0.3, step: 0.005, label: 'Bulge', random: [0, 0.15] },
      wriggle: { id: 'a3ef', value: 0.35, min: 0, max: 1.5, step: 0.01, label: 'Wriggle', random: [0.1, 0.8] },
      bend: { id: '08ee', value: 1.0, min: 0, max: 3, step: 0.01, label: 'Bend', random: [0, 2] },
      melt: { id: 'c422', value: 0.35, min: 0, max: 1, step: 0.01, label: 'Melt', random: [0.1, 0.7] },
      dist: { id: '07e0', value: 2.6, min: 1, max: 8, step: 0.05, label: 'Dist', random: [1.8, 4.5] },
      orbit: { id: '97e8', value: 1.0, min: 0, max: 4, step: 0.01, label: 'Orbit', random: [0.25, 2.5] },
      hue: { id: '7ea0', value: 0, min: 0, max: 1, step: 0.01, label: 'Hue', random: true },
      stepScale: { id: '1562', value: 0.9, min: 0.1, max: 1, step: 0.01, label: 'Step' },
      steps: { id: '9719', value: 96, min: 16, max: 160, step: 1, label: 'Steps' },
      reseed: { id: 'b1c1', value: 0, min: 0, max: 1, step: 1, label: 'Seed', widget: 'trigger' },
    };

    this.createShader(coilsFrag);
    this.createOutputFBO();

    // Every new coil starts from its own seed. Patch loads and duplicates
    // then restore the saved params and seed over this one.
    this.randomize();

    // Both clocks are accumulated rather than derived from an absolute time, so
    // turning Speed or Orbit changes the rate without jumping the animation.
    this.time = 0;
    this.angle = 0;
    this.lastTime = performance.now() / 1000;
  }

  process(graph, glCanvas) {
    const now = performance.now() / 1000;
    const dt = Math.min(now - this.lastTime, MAX_DT);
    this.lastTime = now;

    const scaled = dt * this.params.speed.value;
    this.time += scaled;
    this.angle = (this.angle + scaled * ORBIT_RATE * this.params.orbit.value) % TAU;

    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    // Only the aspect ratio is read, so the logical size is what this wants
    this.shader.setUniform('uResolution', [glCanvas.width, glCanvas.height]);
    this.shader.setUniform('uTime', this.time);
    this.shader.setUniform('uAngle', this.angle);
    this.shader.setUniform('uTurns', this.params.turns.value);
    this.shader.setUniform('uRadius', this.params.radius.value);
    this.shader.setUniform('uThick', this.params.thick.value);
    this.shader.setUniform('uLobes', this.params.lobes.value);
    this.shader.setUniform('uBulge', this.params.bulge.value);
    this.shader.setUniform('uWriggle', this.params.wriggle.value);
    this.shader.setUniform('uBend', this.params.bend.value);
    this.shader.setUniform('uMelt', this.params.melt.value);
    this.shader.setUniform('uDist', this.params.dist.value);
    this.shader.setUniform('uHue', this.params.hue.value);
    this.shader.setUniform('uStepScale', this.params.stepScale.value);
    this.shader.setUniform('uSteps', this.params.steps.value);
    this.renderQuad();
    this.outputFBO.end();
  }

  onTrigger(name) {
    if (name === 'reseed') this.randomize();
  }

  triggerText(name) {
    return name === 'reseed' ? this.seed : '';
  }
}

registerModule('Coils', CoilsModule);
