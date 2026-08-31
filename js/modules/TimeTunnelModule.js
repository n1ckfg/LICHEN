import { Module } from './Module.js';
import { timetunnelFrag } from '../shaders/timetunnel.js';
import { registerModule } from '../moduleRegistry.js';

export class TimeTunnelModule extends Module {
  constructor(glCanvas, id) {
    super('TimeTunnel', glCanvas, id);
    this.inputs = [{ name: 'in', type: 'video' }];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      zoom: { value: 3.0, min: 0.5, max: 10, step: 0.1, label: 'Zoom' },
      speed: { value: 1.0, min: 0.0, max: 5, step: 0.01, label: 'Speed' },
    };
    this.createShader(timetunnelFrag);
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
    this.shader.setUniform('zoom', this.params.zoom.value);
    this.shader.setUniform('speed', this.params.speed.value);
    this.renderQuad();
    this.outputFBO.end();
  }
}

registerModule('TimeTunnel', TimeTunnelModule);
