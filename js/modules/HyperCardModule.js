import { Module } from './Module.js';
import { hypercardFrag } from '../shaders/hypercard.js';
import { registerModule } from '../moduleRegistry.js';

export class HyperCardModule extends Module {
  constructor(glCanvas, id) {
    super('HyperCard', glCanvas, id);
    this.inputs = [{ name: 'in', type: 'video' }];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      finalThreshold: { value: 0.4, min: 0, max: 1, step: 0.01, label: 'Thresh' },
    };
    this.createShader(hypercardFrag);
    this.createOutputFBO();
  }

  process(graph, glCanvas) {
    const inputFBO = this.getInput(graph, 0);
    if (!inputFBO) return;
    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('tex0', inputFBO);
    this.shader.setUniform('finalThreshold', this.params.finalThreshold.value);
    this.shader.setUniform('uResolution', [glCanvas.width, glCanvas.height]);
    this.renderQuad();
    this.outputFBO.end();
  }
}

registerModule('HyperCard', HyperCardModule);
