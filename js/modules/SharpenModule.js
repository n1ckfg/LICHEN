import { Module } from './Module.js';
import { sharpenFrag } from '../shaders/sharpen.js';
import { registerModule } from '../moduleRegistry.js';

export class SharpenModule extends Module {
  constructor(glCanvas, id) {
    super('Sharpen', glCanvas, id);
    this.inputs = [{ name: 'in', type: 'video' }];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      sharpenAmount: { value: 5, min: 1, max: 10, step: 0.1, label: 'Sharpen' },
      posterizeLevels: { value: 16, min: 2, max: 32, step: 1, label: 'Posterize' },
    };
    this.createShader(sharpenFrag);
    this.createOutputFBO();
  }

  process(graph, glCanvas) {
    const inputFBO = this.getInput(graph, 0);
    if (!inputFBO) return;
    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('tex0', inputFBO);
    this.shader.setUniform('texelSize', [1.0 / glCanvas.width, 1.0 / glCanvas.height]);
    this.shader.setUniform('sharpenAmount', this.params.sharpenAmount.value);
    this.shader.setUniform('posterizeLevels', this.params.posterizeLevels.value);
    this.renderQuad();
    this.outputFBO.end();
  }
}

registerModule('Sharpen', SharpenModule);
