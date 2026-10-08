import { Module } from './Module.js';
import { mosaicFrag } from '../shaders/mosaic.js';
import { registerModule } from '../moduleRegistry.js';

export class MosaicModule extends Module {
  static uid = 'efc612b3';

  constructor(glCanvas, id) {
    super('Mosaic', glCanvas, id);
    this.inputs = [{ id: 'f455', name: 'in', type: 'video' }];
    this.outputs = [{ id: '7480', name: 'out', type: 'video' }];
    this.params = {
      pixelsW: { id: '9c49', value: 252, min: 2, max: 4096, step: 1, label: 'Width' },
      pixelsH: { id: '322b', value: 184, min: 2, max: 4096, step: 1, label: 'Height' },
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
