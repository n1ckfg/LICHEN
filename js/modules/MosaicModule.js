import { Module } from './Module.js';
import { mosaicFrag } from '../shaders/mosaic.js';
import { registerModule } from '../moduleRegistry.js';

export class MosaicModule extends Module {
  constructor(glCanvas, id) {
    super('Mosaic', glCanvas, id);
    this.inputs = [{ name: 'in', type: 'video' }];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      pixels: { value: 50, min: 2, max: 200, step: 1, label: 'Pixels' },
    };
    this.createShader(mosaicFrag);
    this.createOutputFBO();
  }

  process(graph, glCanvas) {
    const inputFBO = this.getInput(graph, 0);
    if (!inputFBO) return;

    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('tex0', inputFBO);
    this.shader.setUniform('pixels', this.params.pixels.value);
    this.renderQuad();
    this.outputFBO.end();
  }
}

registerModule('Mosaic', MosaicModule);
