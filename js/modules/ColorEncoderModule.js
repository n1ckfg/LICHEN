import { Module } from './Module.js';
import { colorEncoderFrag } from '../shaders/color-encoder.js';
import { registerModule } from '../moduleRegistry.js';

export class ColorEncoderModule extends Module {
  static uid = 'cd55eb84';

  constructor(glCanvas, id) {
    super('ColorEncoder', glCanvas, id);
    this.inputs = [{ id: '87a9', name: 'in', type: 'video' }];
    this.outputs = [{ id: '1bc2', name: 'out', type: 'video' }];
    this.historicalInfo="Sandin"
    this.params = {
      phaseR: { id: '4704', value: 0, min: 0, max: 6.283, step: 0.01, label: 'Phase R' },
      phaseG: { id: '4ca6', value: 2.094, min: 0, max: 6.283, step: 0.01, label: 'Phase G' },
      phaseB: { id: '0132', value: 4.189, min: 0, max: 6.283, step: 0.01, label: 'Phase B' },
      frequency: { id: '83af', value: 1, min: 0.1, max: 10, step: 0.01, label: 'Freq' },
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
