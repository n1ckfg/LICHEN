import { Module } from './Module.js';
import { glitchFrag } from '../shaders/glitch.js';
import { registerModule } from '../moduleRegistry.js';

export class GlitchModule extends Module {
  constructor(glCanvas, id) {
    super('Glitch', glCanvas, id);
    this.inputs = [
      { name: 'in', type: 'video' },
      { name: 'bars', type: 'video' },
    ];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      barsamount: { value: 1, min: 0, max: 2, step: 0.01, label: 'Bars' },
      distortion: { value: 1, min: 0, max: 5, step: 0.01, label: 'Distort' },
      vsync: { value: 0, min: -1, max: 1, step: 0.01, label: 'V-Sync' },
      hsync: { value: 0, min: -1, max: 1, step: 0.01, label: 'H-Sync' },
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
