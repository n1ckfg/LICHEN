import { Module } from './Module.js';
import { spatialSliceFrag } from '../shaders/spatial-slice.js';
import { registerModule } from '../moduleRegistry.js';

export class SpatialSliceModule extends Module {
  constructor(glCanvas, id) {
    super('SpatialSlice', glCanvas, id);
    this.inputs = [{ name: 'in', type: 'video' }];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      sliceWidth: { value: 20, min: 1, max: 100, step: 1, label: 'Slices' },
      sliceSpeed: { value: 0.5, min: 0, max: 2, step: 0.01, label: 'Speed' },
      offsetAmount: { value: 0.1, min: 0, max: 0.5, step: 0.01, label: 'Offset' },
      chromatic: { value: 1.0, min: 0, max: 3, step: 0.01, label: 'Chroma' },
    };
    this.createShader(spatialSliceFrag);
    this.createOutputFBO();
    this.startTime = performance.now();
  }

  process(graph, glCanvas) {
    const inputFBO = this.getInput(graph, 0);
    if (!inputFBO) return;

    const time = (performance.now() - this.startTime) / 1000.0;

    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('tex0', inputFBO);
    this.shader.setUniform('time', time);
    this.shader.setUniform('sliceWidth', this.params.sliceWidth.value);
    this.shader.setUniform('sliceSpeed', this.params.sliceSpeed.value);
    this.shader.setUniform('offsetAmount', this.params.offsetAmount.value);
    this.shader.setUniform('chromatic', this.params.chromatic.value);
    this.renderQuad();
    this.outputFBO.end();
  }
}

registerModule('SpatialSlice', SpatialSliceModule);
