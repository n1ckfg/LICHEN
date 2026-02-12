import { Module } from './Module.js';
import { adderMultiplierFrag } from '../shaders/adder-multiplier.js';
import { registerModule } from '../moduleRegistry.js';

export class AdderMultiplierModule extends Module {
  constructor(glCanvas, id) {
    super('AdderMultiplier', glCanvas, id);
    this.inputs = [
      { name: 'in1', type: 'video' },
      { name: 'in2', type: 'video' },
    ];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      mode: { value: 0, min: 0, max: 3, step: 1, label: 'Mode' },
      mixVal: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Mix' },
      contrast: { value: 1, min: 0, max: 3, step: 0.01, label: 'Contrast' },
    };
    this.createShader(adderMultiplierFrag);
    this.createOutputFBO();
  }

  process(graph, glCanvas) {
    const input0 = this.getInput(graph, 0);
    const input1 = this.getInput(graph, 1);
    if (!input0) return;
    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('tex0', input0);
    this.shader.setUniform('tex1', input1 || input0);
    this.shader.setUniform('mode', this.params.mode.value);
    this.shader.setUniform('mixVal', this.params.mixVal.value);
    this.shader.setUniform('contrast', this.params.contrast.value);
    this.renderQuad();
    this.outputFBO.end();
  }
}

registerModule('AdderMultiplier', AdderMultiplierModule);
