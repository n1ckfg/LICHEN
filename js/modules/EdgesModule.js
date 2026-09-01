import { Module } from './Module.js';
import { edgesFrag } from '../shaders/edges.js';
import { registerModule } from '../moduleRegistry.js';

export class EdgesModule extends Module {
  constructor(glCanvas, id) {
    super('Edges', glCanvas, id);
    this.inputs = [{ name: 'in', type: 'video' }];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      mode: {
        value: 0, min: 0, max: 3, step: 1, label: 'Mode',
        valueLabels: ['Refine Contour', 'Scharr', 'Quantum Walk', 'Grayscale (debug)'],
      },
      threshold: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Threshold' },
    };
    this.createShader(edgesFrag);
    this.createOutputFBO();
  }

  process(graph, glCanvas) {
    const inputFBO = this.getInput(graph, 0);
    if (!inputFBO) return;
    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('tex0', inputFBO);
    this.shader.setUniform('texelSize', [1.0 / glCanvas.width, 1.0 / glCanvas.height]);
    this.shader.setUniform('mode', Math.round(this.params.mode.value));
    this.shader.setUniform('threshold', this.params.threshold.value);
    this.renderQuad();
    this.outputFBO.end();
  }
}

registerModule('Edges', EdgesModule);
