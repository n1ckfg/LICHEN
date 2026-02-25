import { Module } from './Module.js';
import { colorEncoderFrag } from '../shaders/color-encoder.js';
import { registerModule } from '../moduleRegistry.js';

export class ColorEncoderModule extends Module {
  constructor(glCanvas, id) {
    super('ColorEncoder', glCanvas, id);
    this.inputs = [{ name: 'in', type: 'video' }];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      phaseR: { value: 0, min: 0, max: 6.283, step: 0.01, label: 'Phase R' },
      phaseG: { value: 2.094, min: 0, max: 6.283, step: 0.01, label: 'Phase G' },
      phaseB: { value: 4.189, min: 0, max: 6.283, step: 0.01, label: 'Phase B' },
      frequency: { value: 1, min: 0.1, max: 10, step: 0.01, label: 'Freq' },
    };
    this.createShader(colorEncoderFrag);
    this.createOutputFBO();
  }

  process(graph, glCanvas) {
    const inputFBO = this.getInput(graph, 0);
    if (!inputFBO) return;
    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('tex0', inputFBO);
    this.shader.setUniform('phaseR', this.params.phaseR.value);
    this.shader.setUniform('phaseG', this.params.phaseG.value);
    this.shader.setUniform('phaseB', this.params.phaseB.value);
    this.shader.setUniform('frequency', this.params.frequency.value);
    this.renderQuad();
    this.outputFBO.end();
  }
}

registerModule('ColorEncoder', ColorEncoderModule);
