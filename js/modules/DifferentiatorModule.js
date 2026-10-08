import { Module } from './Module.js';
import { differentiatorFrag } from '../shaders/differentiator.js';
import { registerModule } from '../moduleRegistry.js';

export class DifferentiatorModule extends Module {
  static uid = 'ad9f6859';

  constructor(glCanvas, id) {
    super('Differentiator', glCanvas, id);
    this.inputs = [{ id: 'a770', name: 'in', type: 'video' }];
    this.outputs = [{ id: 'a7d4', name: 'out', type: 'video' }];
    this.historicalInfo="Sandin"
    this.params = {
      strength: { id: 'aed7', value: 1, min: 0, max: 5, step: 0.01, label: 'Strength' },
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
