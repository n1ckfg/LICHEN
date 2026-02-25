import { Module } from './Module.js';
import { syncGeneratorFrag } from '../shaders/sync-generator.js';
import { registerModule } from '../moduleRegistry.js';

export class SyncGeneratorModule extends Module {
  constructor(glCanvas, id) {
    super('SyncGenerator', glCanvas, id);
    this.inputs = [{ name: 'in', type: 'video' }];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      steps: { value: 4, min: 2, max: 32, step: 1, label: 'Steps' },
      mode: { value: 0, min: 0, max: 2, step: 1, label: 'Mode' },
    };
    this.createShader(syncGeneratorFrag);
    this.createOutputFBO();
  }

  process(graph, glCanvas) {
    const inputFBO = this.getInput(graph, 0);
    if (!inputFBO) return;
    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('tex0', inputFBO);
    this.shader.setUniform('steps', this.params.steps.value);
    this.shader.setUniform('mode', this.params.mode.value);
    this.renderQuad();
    this.outputFBO.end();
  }
}

registerModule('SyncGenerator', SyncGeneratorModule);
