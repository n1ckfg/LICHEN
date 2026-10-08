import { Module } from './Module.js';
import { valueScramblerFrag } from '../shaders/value-scrambler.js';
import { registerModule } from '../moduleRegistry.js';

export class ValueScramblerModule extends Module {
  static uid = '6a1e3f93';

  constructor(glCanvas, id) {
    super('ValueScrambler', glCanvas, id);
    this.inputs = [{ id: '4836', name: 'in', type: 'video' }];
    this.outputs = [{ id: 'b2ad', name: 'out', type: 'video' }];
    this.historicalInfo="Sandin"
    this.params = {
      levels: { id: 'd5bd', value: 8, min: 2, max: 32, step: 1, label: 'Levels' },
      scramble: { id: 'ab64', value: 0.5, min: 0, max: 1, step: 0.01, label: 'Scramble' },
    };
    this.createShader(valueScramblerFrag);
    this.createOutputFBO();
  }

  process(graph, glCanvas) {
    const inputFBO = this.getInput(graph, 0);
    if (!inputFBO) return;
    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('tex0', inputFBO);
    this.shader.setUniform('levels', this.params.levels.value);
    this.shader.setUniform('scramble', this.params.scramble.value);
    this.renderQuad();
    this.outputFBO.end();
  }
}

registerModule('ValueScrambler', ValueScramblerModule);
