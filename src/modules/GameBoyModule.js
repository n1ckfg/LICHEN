import { Module } from './Module.js';
import { gameboyFrag } from '../shaders/gameboy.js';
import { registerModule } from '../moduleRegistry.js';

export class GameBoyModule extends Module {
  constructor(glCanvas, id) {
    super('GameBoy', glCanvas, id);
    this.inputs = [{ name: 'in', type: 'video' }];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {};
    this.createShader(gameboyFrag);
    this.createOutputFBO();
  }

  process(graph, glCanvas) {
    const inputFBO = this.getInput(graph, 0);
    if (!inputFBO) return;
    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('tex0', inputFBO);
    this.shader.setUniform('uResolution', [glCanvas.width, glCanvas.height]);
    this.renderQuad();
    this.outputFBO.end();
  }
}

registerModule('GameBoy', GameBoyModule);
