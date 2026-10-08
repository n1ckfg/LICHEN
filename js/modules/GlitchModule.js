import { Module } from './Module.js';
import { glitchFrag } from '../shaders/glitch.js';
import { registerModule } from '../moduleRegistry.js';

export class GlitchModule extends Module {
  static uid = 'fd69c128';

  constructor(glCanvas, id) {
    super('Glitch', glCanvas, id);
    this.inputs = [
      { id: '296d', name: 'in', type: 'video' },
      { id: '7420', name: 'bars', type: 'video' },
    ];
    this.outputs = [{ id: 'eb16', name: 'out', type: 'video' }];
    this.params = {
      barsamount: { id: '37ef', value: 1, min: 0, max: 2, step: 0.01, label: 'Bars' },
      distortion: { id: '900b', value: 1, min: 0, max: 5, step: 0.01, label: 'Distort' },
      vsync: { id: '1cc3', value: 0, min: -1, max: 1, step: 0.01, label: 'V-Sync' },
      hsync: { id: '3bf8', value: 0, min: -1, max: 1, step: 0.01, label: 'H-Sync' },
    };
    this.createShader(glitchFrag);
    this.createOutputFBO();
  }

  process(graph, glCanvas) {
    const input0 = this.getInput(graph, 0);
    const input1 = this.getInput(graph, 1);
    if (!input0) return;
    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('tex0', input0);
    this.shader.setUniform('tex1', input1 || input0);
    this.shader.setUniform('barsamount', this.params.barsamount.value);
    this.shader.setUniform('distortion', this.params.distortion.value);
    this.shader.setUniform('vsync', this.params.vsync.value);
    this.shader.setUniform('hsync', this.params.hsync.value);
    this.shader.setUniform('uResolution', [glCanvas.width, glCanvas.height]);
    this.renderQuad();
    this.outputFBO.end();
  }
}

registerModule('Glitch', GlitchModule);
