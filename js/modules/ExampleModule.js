import { Module } from './Module.js';
import { exampleFrag } from '../shaders/example.js';
import { registerModule } from '../moduleRegistry.js';

export class ExampleModule extends Module {
  static uid = '3d456d73';

  constructor(glCanvas, id) {
    super('Example', glCanvas, id);
    this.inputs = [{ id: 'a39e', name: 'in', type: 'video' }];
    this.outputs = [{ id: '4b22', name: 'out', type: 'video' }];
    this.params = {
      brightness: { id: '7313', value: 0, min: -1, max: 1, step: 0.01, label: 'Bright' },
    };
    this.createShader(exampleFrag);
    this.createOutputFBO();
  }

  process(graph, glCanvas) {
    const input = this.getInput(graph, 0);
    if (!input) return;
    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('tex0', input);
    this.shader.setUniform('brightness', this.params.brightness.value);
    this.renderQuad();
    this.outputFBO.end();
  }
}

registerModule('Example', ExampleModule);
