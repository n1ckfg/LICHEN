import { Module } from './Module.js';
import { booleanLogicFrag } from '../shaders/boolean-logic.js';
import { registerModule } from '../moduleRegistry.js';

// Patches save op as its index, so new operators are appended, never inserted.
// The shader reads each odd one as the even one before it, inverted.
const OPS = ['XOR', 'XNOR', 'AND', 'NAND', 'OR', 'NOR'];

export class BooleanLogicModule extends Module {
  static uid = '791a82b0';

  constructor(glCanvas, id) {
    super('BooleanLogic', glCanvas, id);
    this.inputs = [{ id: 'b7e0', name: 'in', type: 'video' }];
    this.outputs = [{ id: '67ec', name: 'out', type: 'video' }];
    // The defaults are the constants the shader had before they were knobs.
    // The seed picks the pattern; Speed and Intensity are master controls, so
    // it leaves them alone.
    this.params = {
      speed: { id: '462b', value: 1.0, min: 0, max: 5, step: 0.01, label: 'Speed' },
      intensity: { id: 'd3d3', value: 1.0, min: 0, max: 1, step: 0.01, label: 'Intensity' },
      op: { id: 'a8fa', value: 0, min: 0, max: OPS.length - 1, step: 1, label: 'Op', widget: 'dropdown', valueLabels: OPS, random: true },
      scale: { id: 'fe64', value: 1, min: 0, max: 8, step: 0.05, label: 'Scale', random: [0.5, 4] },
      driftX: { id: 'e41c', value: 50, min: -200, max: 200, step: 1, label: 'Drift X', random: [-100, 100] },
      driftY: { id: 'c1fc', value: -30, min: -200, max: 200, step: 1, label: 'Drift Y', random: [-100, 100] },
      driftXY: { id: '5541', value: 0, min: -200, max: 200, step: 1, label: 'Drift XY', random: [-100, 100] },
      reseed: { id: '0057', value: 0, min: 0, max: 1, step: 1, label: 'Seed', widget: 'trigger' },
    };
    this.createShader(booleanLogicFrag);
    this.createOutputFBO();

    // Every new node starts from its own seed. Patch loads and duplicates
    // then restore the saved params and seed over this one.
    this.randomize();

    this.startTime = performance.now();
  }

  process(graph, glCanvas) {
    const inputFBO = this.getInput(graph, 0);
    if (!inputFBO) return;

    const time = (performance.now() - this.startTime) / 1000.0;

    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('tex0', inputFBO);
    this.shader.setUniform('time', time);
    this.shader.setUniform('speed', this.params.speed.value);
    this.shader.setUniform('intensity', this.params.intensity.value);
    this.shader.setUniform('op', this.params.op.value);
    this.shader.setUniform('scale', this.params.scale.value);
    this.shader.setUniform('driftX', this.params.driftX.value);
    this.shader.setUniform('driftY', this.params.driftY.value);
    this.shader.setUniform('driftXY', this.params.driftXY.value);
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

registerModule('BooleanLogic', BooleanLogicModule);
