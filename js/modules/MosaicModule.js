import { Module } from './Module.js';
import { mosaicFrag } from '../shaders/mosaic.js';
import { registerModule } from '../moduleRegistry.js';

export class MosaicModule extends Module {
  constructor(glCanvas, id) {
    super('Mosaic', glCanvas, id);
    this.inputs = [{ name: 'in', type: 'video' }];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      pixelsW: { value: 252, min: 2, max: 4096, step: 1, label: 'Width' },
      pixelsH: { value: 184, min: 2, max: 4096, step: 1, label: 'Height' },
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
    this.shader.setUniform('pixelsW', this.params.pixelsW.value);
    this.shader.setUniform('pixelsH', this.params.pixelsH.value);
    this.renderQuad();
    this.outputFBO.end();
  }
}

registerModule('Mosaic', MosaicModule);
