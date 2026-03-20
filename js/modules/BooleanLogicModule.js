import { Module } from './Module.js';
import { booleanLogicFrag } from '../shaders/boolean-logic.js';
import { registerModule } from '../moduleRegistry.js';

export class BooleanLogicModule extends Module {
  constructor(glCanvas, id) {
    super('BooleanLogic', glCanvas, id);
    this.inputs = [{ name: 'in', type: 'video' }];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      speed: { value: 1.0, min: 0, max: 5, step: 0.01, label: 'Speed' },
      intensity: { value: 1.0, min: 0, max: 1, step: 0.01, label: 'Intensity' },
    };
    this.createShader(booleanLogicFrag);
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
    this.shader.setUniform('speed', this.params.speed.value);
    this.shader.setUniform('intensity', this.params.intensity.value);
    this.renderQuad();
    this.outputFBO.end();
  }
}

registerModule('BooleanLogic', BooleanLogicModule);
