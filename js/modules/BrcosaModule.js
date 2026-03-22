import { Module } from './Module.js';
import { brcosaFrag } from '../shaders/brcosa.js';
import { registerModule } from '../moduleRegistry.js';

export class BrcosaModule extends Module {
  constructor(glCanvas, id) {
    super('Brcosa', glCanvas, id);
    this.inputs = [{ name: 'in', type: 'video' }];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      brightness: { value: 0, min: -1, max: 1, step: 0.01, label: 'Bright' },
      contrast: { value: 1, min: 0, max: 3, step: 0.01, label: 'Contrast' },
      saturation: { value: 1, min: 0, max: 3, step: 0.01, label: 'Sat' },
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
