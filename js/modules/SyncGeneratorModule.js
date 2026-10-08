import { Module } from './Module.js';
import { syncGeneratorFrag } from '../shaders/sync-generator.js';
import { registerModule } from '../moduleRegistry.js';

export class SyncGeneratorModule extends Module {
  static uid = '6c5dcbe9';

  constructor(glCanvas, id) {
    super('SyncGenerator', glCanvas, id);
    this.inputs = [{ id: '6d7f', name: 'in', type: 'video' }];
    this.outputs = [{ id: '5ee8', name: 'out', type: 'video' }];
    this.historicalInfo="Sandin"
    this.params = {
      steps: { id: '042d', value: 4, min: 2, max: 32, step: 1, label: 'Steps' },
      mode: {
        id: '1238', value: 0, min: 0, max: 2, step: 1, label: 'Mode', widget: 'dropdown',
        valueLabels: ['Floor', 'Round', 'Gamma'],
      },
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
