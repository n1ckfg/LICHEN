import { Module } from './Module.js';
import { vhscFrag } from '../shaders/vhsc.js';
import { registerModule } from '../moduleRegistry.js';

export class VHSCModule extends Module {
  constructor(glCanvas, id) {
    super('VHSC', glCanvas, id);
    this.inputs = [{ name: 'in', type: 'video' }];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      gamma: { value: 1.2, min: 0.5, max: 3, step: 0.01, label: 'Gamma' },
      posterizeLevels: { value: 90, min: 2, max: 256, step: 1, label: 'Levels' },
      texelSize: { value: 0.008, min: 0.001, max: 0.05, step: 0.001, label: 'Texel' },
    };
    this.createShader(vhscFrag);
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

registerModule('VHSC', VHSCModule);
