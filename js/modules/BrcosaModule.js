import { Module } from './Module.js';
import { brcosaFrag } from '../shaders/brcosa.js';
import { registerModule } from '../moduleRegistry.js';

export class BrcosaModule extends Module {
  static uid = '45d56d73';

  constructor(glCanvas, id) {
    super('Brcosa', glCanvas, id);
    this.inputs = [{ id: 'ae9e', name: 'in', type: 'video' }];
    this.outputs = [{ id: '4b92', name: 'out', type: 'video' }];
    this.params = {
      brightness: { id: '7213', value: 0, min: -1, max: 1, step: 0.01, label: 'Bright' },
      contrast: { id: '0924', value: 1, min: -3, max: 3, step: 0.01, label: 'Contrast' },
      saturation: { id: '1459', value: 1, min: 0, max: 3, step: 0.01, label: 'Sat' },
    };
    this.createShader(brcosaFrag);
    this.createOutputFBO();
  }

  process(graph, glCanvas) {
    const input = this.getInput(graph, 0);
    if (!input) return;
    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('tex0', input);
    this.shader.setUniform('brightness', this.params.brightness.value);
    this.shader.setUniform('contrast', this.params.contrast.value);
    this.shader.setUniform('saturation', this.params.saturation.value);
    this.renderQuad();
    this.outputFBO.end();
  }
}

registerModule('Brcosa', BrcosaModule);
