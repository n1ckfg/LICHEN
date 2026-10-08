import { Module } from './Module.js';
import { gameboyFrag } from '../shaders/gameboy.js';
import { registerModule } from '../moduleRegistry.js';

export class GameBoyModule extends Module {
  static uid = '1373de62';

  constructor(glCanvas, id) {
    super('GameBoy', glCanvas, id);
    this.inputs = [{ id: '628c', name: 'in', type: 'video' }];
    this.outputs = [{ id: 'b6a9', name: 'out', type: 'video' }];
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
