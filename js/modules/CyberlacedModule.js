import { Module } from './Module.js';
import { cyberlacedFrag } from '../shaders/cyberlaced.js';
import { registerModule } from '../moduleRegistry.js';

export class CyberlacedModule extends Module {
  constructor(glCanvas, id) {
    super('Cyberlaced', glCanvas, id);
    this.inputs = [{ name: 'in', type: 'video' }];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      levels: { value: 4, min: 2, max: 4, step: 1, label: 'Levels' },
    };
    this.createShader(cyberlacedFrag);
    this.createOutputFBO();
  }

  process(graph, glCanvas) {
    const inputFBO = this.getInput(graph, 0);
    if (!inputFBO) return;
    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('tex0', inputFBO);
    this.shader.setUniform('levels', this.params.levels.value);
    this.shader.setUniform('uResolution', [glCanvas.width, glCanvas.height]);
    this.renderQuad();
    this.outputFBO.end();
  }
}

registerModule('Cyberlaced', CyberlacedModule);
