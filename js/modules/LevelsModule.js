import { Module } from './Module.js';
import { levelsFrag } from '../shaders/levels.js';
import { registerModule } from '../moduleRegistry.js';

export class LevelsModule extends Module {
  static uid = '1889203c';

  constructor(glCanvas, id) {
    super('Levels', glCanvas, id);
    this.inputs = [{ id: '22ce', name: 'in', type: 'video' }];
    this.outputs = [{ id: 'e6d3', name: 'out', type: 'video' }];
    this.params = {
      blackLevel: { id: '7427', value: 0, min: 0, max: 1, step: 0.01, label: 'Black' },
      gamma: { id: 'caad', value: 1, min: 0.1, max: 3, step: 0.01, label: 'Gamma' },
      whiteLevel: { id: 'c3b8', value: 1, min: 0, max: 1, step: 0.01, label: 'White' },
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
