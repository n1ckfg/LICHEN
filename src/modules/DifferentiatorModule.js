import { Module } from './Module.js';
import { differentiatorFrag } from '../shaders/differentiator.js';
import { registerModule } from '../moduleRegistry.js';

export class DifferentiatorModule extends Module {
  constructor(glCanvas, id) {
    super('Differentiator', glCanvas, id);
    this.inputs = [{ name: 'in', type: 'video' }];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      strength: { value: 1, min: 0, max: 5, step: 0.01, label: 'Strength' },
    };
    this.createShader(differentiatorFrag);
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
    this.shader.setUniform('strength', this.params.strength.value);
    this.renderQuad();
    this.outputFBO.end();
  }
}

registerModule('Differentiator', DifferentiatorModule);
