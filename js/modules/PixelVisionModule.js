import { Module } from './Module.js';
import { pixelvisionFrag } from '../shaders/pixelvision.js';
import { registerModule } from '../moduleRegistry.js';

export class PixelVisionModule extends Module {
  static uid = '5c7aa061';

  constructor(glCanvas, id) {
    super('PixelVision', glCanvas, id);
    this.inputs = [{ id: '0040', name: 'in', type: 'video' }];
    this.outputs = [{ id: '55c1', name: 'out', type: 'video' }];
    this.params = {
      gamma: { id: '0b91', value: 1.2, min: 0.5, max: 3, step: 0.01, label: 'Gamma' },
      posterizeLevels: { id: 'd95c', value: 90, min: 2, max: 256, step: 1, label: 'Levels' },
      texelSize: { id: 'efb6', value: 0.008, min: 0.001, max: 0.05, step: 0.001, label: 'Texel' },
    };
    this.createShader(pixelvisionFrag);
    this.createOutputFBO();
  }

  process(graph, glCanvas) {
    const inputFBO = this.getInput(graph, 0);
    if (!inputFBO) return;
    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('tex0', inputFBO);
    this.shader.setUniform('gamma', this.params.gamma.value);
    this.shader.setUniform('posterizeLevels', this.params.posterizeLevels.value);
    this.shader.setUniform('texelSize', [this.params.texelSize.value, this.params.texelSize.value * 1.375]);
    this.renderQuad();
    this.outputFBO.end();
  }
}

registerModule('PixelVision', PixelVisionModule);
