import { Module } from './Module.js';
import { levelsFrag } from '../shaders/levels.js';
import { registerModule } from '../moduleRegistry.js';

export class LevelsModule extends Module {
  constructor(glCanvas, id) {
    super('Levels', glCanvas, id);
    this.inputs = [{ name: 'in', type: 'video' }];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      blackLevel: { value: 0, min: 0, max: 1, step: 0.01, label: 'Black' },
      gamma: { value: 1, min: 0.1, max: 3, step: 0.01, label: 'Gamma' },
      whiteLevel: { value: 1, min: 0, max: 1, step: 0.01, label: 'White' },
    };
    this.createShader(levelsFrag);
    this.createOutputFBO();
  }

  process(graph, glCanvas) {
    const input = this.getInput(graph, 0);
    if (!input) return;
    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('tex0', input);
    this.shader.setUniform('blackLevel', this.params.blackLevel.value);
    this.shader.setUniform('gamma', this.params.gamma.value);
    this.shader.setUniform('whiteLevel', this.params.whiteLevel.value);
    this.renderQuad();
    this.outputFBO.end();
  }
}

registerModule('Levels', LevelsModule);
