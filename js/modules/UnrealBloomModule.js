import { Module } from './Module.js';
import { unrealbloomFrag } from '../shaders/unrealbloom.js';
import { registerModule } from '../moduleRegistry.js';

export class UnrealBloomModule extends Module {
  constructor(glCanvas, id) {
    super('UnrealBloom', glCanvas, id);
    this.inputs = [{ name: 'in', type: 'video' }];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      threshold: { value: 0.8, min: 0.0, max: 1.0, step: 0.01, label: 'Threshold' },
      strength: { value: 1.5, min: 0.0, max: 5.0, step: 0.01, label: 'Strength' },
      radius: { value: 4.0, min: 1.0, max: 16.0, step: 0.1, label: 'Radius' },
    };
    this.createShader(unrealbloomFrag);
    this.createOutputFBO();
  }

  process(graph, glCanvas) {
    const inputFBO = this.getInput(graph, 0);
    if (!inputFBO) return;
    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('tex0', inputFBO);
    this.shader.setUniform('uResolution', [glCanvas.width, glCanvas.height]);
    this.shader.setUniform('threshold', this.params.threshold.value);
    this.shader.setUniform('strength', this.params.strength.value);
    this.shader.setUniform('radius', this.params.radius.value);
    this.renderQuad();
    this.outputFBO.end();
  }
}

registerModule('UnrealBloom', UnrealBloomModule);
