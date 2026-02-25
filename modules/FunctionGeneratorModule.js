import { Module } from './Module.js';
import { functionGeneratorFrag } from '../shaders/function-generator.js';
import { registerModule } from '../moduleRegistry.js';

export class FunctionGeneratorModule extends Module {
  constructor(glCanvas, id) {
    super('FunctionGenerator', glCanvas, id);
    this.inputs = [{ name: 'in', type: 'video' }];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      curve: { value: 0, min: 0, max: 5, step: 1, label: 'Curve' },
      gain: { value: 1, min: 0, max: 3, step: 0.01, label: 'Gain' },
    };
    this.createShader(functionGeneratorFrag);
    this.createOutputFBO();
  }

  process(graph, glCanvas) {
    const inputFBO = this.getInput(graph, 0);
    if (!inputFBO) return;
    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('tex0', inputFBO);
    this.shader.setUniform('curve', this.params.curve.value);
    this.shader.setUniform('gain', this.params.gain.value);
    this.renderQuad();
    this.outputFBO.end();
  }
}

registerModule('FunctionGenerator', FunctionGeneratorModule);
