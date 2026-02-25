import { Module } from './Module.js';
import { valueScramblerFrag } from '../shaders/value-scrambler.js';
import { registerModule } from '../moduleRegistry.js';

export class ValueScramblerModule extends Module {
  constructor(glCanvas, id) {
    super('ValueScrambler', glCanvas, id);
    this.inputs = [{ name: 'in', type: 'video' }];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      levels: { value: 8, min: 2, max: 32, step: 1, label: 'Levels' },
      scramble: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Scramble' },
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
