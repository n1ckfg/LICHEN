import { Module } from './Module.js';
import { tvFrag } from '../shaders/tv.js';
import { registerModule } from '../moduleRegistry.js';

export class TVLinesModule extends Module {
  static uid = 'd5a84eef';

  constructor(glCanvas, id) {
    super('TVLines', glCanvas, id);
    this.inputs = [{ id: '8f1f', name: 'in', type: 'video' }];
    this.outputs = [{ id: '9dcc', name: 'out', type: 'video' }];
    this.params = {
      lineThickness: { id: '2cb2', value: 4, min: 0.1, max: 5, step: 0.01, label: 'Thickness' },
      lineDarkness: { id: '580a', value: 0.1, min: 0, max: 1, step: 0.01, label: 'Darkness' },
      flicker: { id: '89f0', value: 0.01, min: 0, max: 0.2, step: 0.001, label: 'Flicker' },
    };
    this.createShader(tvFrag);
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
    this.shader.setUniform('lineThickness', this.params.lineThickness.value);
    this.shader.setUniform('lineDarkness', this.params.lineDarkness.value);
    this.shader.setUniform('flicker', this.params.flicker.value);
    this.shader.setUniform('uResolution', [glCanvas.width, glCanvas.height]);
    this.renderQuad();
    this.outputFBO.end();
  }
}

registerModule('TVLines', TVLinesModule);
