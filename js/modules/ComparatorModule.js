import { Module } from './Module.js';
import { comparatorFrag } from '../shaders/comparator.js';
import { registerModule } from '../moduleRegistry.js';

export class ComparatorModule extends Module {
  constructor(glCanvas, id) {
    super('Comparator', glCanvas, id);
    this.inputs = [{ name: 'in', type: 'video' }];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      threshold: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Thresh' },
    };
    this.createShader(comparatorFrag);
    this.createOutputFBO();
  }

  process(graph, glCanvas) {
    const inputFBO = this.getInput(graph, 0);
    if (!inputFBO) return;
    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('tex0', inputFBO);
    this.shader.setUniform('threshold', this.params.threshold.value);
    this.renderQuad();
    this.outputFBO.end();
  }
}

registerModule('Comparator', ComparatorModule);
