import { Module } from './Module.js';
import { oscillatorFrag } from '../shaders/oscillator.js';
import { registerModule } from '../moduleRegistry.js';

export class OscillatorModule extends Module {
  constructor(glCanvas, id) {
    super('Oscillator', glCanvas, id);
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      frequency: { value: 4, min: 0.1, max: 50, step: 0.1, label: 'Freq' },
      waveform: { value: 0, min: 0, max: 3, step: 1, label: 'Wave' },
      direction: { value: 0, min: 0, max: 2, step: 1, label: 'Dir' },
    };
    this.createShader(oscillatorFrag);
    this.createOutputFBO();
  }

  process(graph, glCanvas) {
    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('time', performance.now() / 1000.0);
    this.shader.setUniform('frequency', this.params.frequency.value);
    this.shader.setUniform('waveform', this.params.waveform.value);
    this.shader.setUniform('direction', this.params.direction.value);
    this.shader.setUniform('uResolution', [glCanvas.width, glCanvas.height]);
    this.renderQuad();
    this.outputFBO.end();
  }
}

registerModule('Oscillator', OscillatorModule);
