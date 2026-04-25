import { Module } from './Module.js';
import { maelstromFrag } from '../shaders/maelstrom.js';
import { registerModule } from '../moduleRegistry.js';

export class MaelstromModule extends Module {
  constructor(glCanvas, id) {
    super('Maelstrom', glCanvas, id);
    this.inputs = [{ name: 'in', type: 'video' }];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      waveFreq: { value: 20.0, min: 1, max: 100, step: 0.5, label: 'Wave Freq' },
      waveSpeed: { value: 2.0, min: 0, max: 10, step: 0.1, label: 'Wave Speed' },
      waveAmount: { value: 0.08, min: 0, max: 0.5, step: 0.01, label: 'Wave Amt' },
      radialStrength: { value: 0.15, min: 0, max: 1, step: 0.01, label: 'Radial Str' },
      radialFreq: { value: 10.0, min: 1, max: 50, step: 0.5, label: 'Radial Freq' },
      radialSpeed: { value: 3.0, min: 0, max: 10, step: 0.1, label: 'Radial Spd' },
      chromaAmount: { value: 0.01, min: 0, max: 0.1, step: 0.001, label: 'Chroma' },
    };

    this.createShader(maelstromFrag);
    this.createOutputFBO();
    this.startTime = performance.now();
  }

  process(graph, glCanvas) {
    const inputFBO = this.getInput(graph, 0);
    if (!inputFBO) return;

    const elapsed = (performance.now() - this.startTime) / 1000;

    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('tex0', inputFBO);
    this.shader.setUniform('uTime', elapsed);
    this.shader.setUniform('uResolution', [glCanvas.width, glCanvas.height]);
    this.shader.setUniform('waveFreq', this.params.waveFreq.value);
    this.shader.setUniform('waveSpeed', this.params.waveSpeed.value);
    this.shader.setUniform('waveAmount', this.params.waveAmount.value);
    this.shader.setUniform('radialStrength', this.params.radialStrength.value);
    this.shader.setUniform('radialFreq', this.params.radialFreq.value);
    this.shader.setUniform('radialSpeed', this.params.radialSpeed.value);
    this.shader.setUniform('chromaAmount', this.params.chromaAmount.value);
    this.renderQuad();
    this.outputFBO.end();
  }
}

registerModule('Maelstrom', MaelstromModule);
