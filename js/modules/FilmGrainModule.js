import { Module } from './Module.js';
import { filmFrag } from '../shaders/film.js';
import { registerModule } from '../moduleRegistry.js';

export class FilmGrainModule extends Module {
  constructor(glCanvas, id) {
    super('FilmGrain', glCanvas, id);
    this.inputs = [{ name: 'in', type: 'video' }];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {};
    this.createShader(filmFrag);
    this.createOutputFBO();
  }

  process(graph, glCanvas) {
    const inputFBO = this.getInput(graph, 0);
    if (!inputFBO) return;
    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('tex0', inputFBO);
    this.shader.setUniform('time', performance.now() / 1000.0);
    this.shader.setUniform('uResolution', [glCanvas.width, glCanvas.height]);
    this.renderQuad();
    this.outputFBO.end();
  }
}

registerModule('FilmGrain', FilmGrainModule);
