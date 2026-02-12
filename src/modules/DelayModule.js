import { Module } from './Module.js';
import { delayFrag } from '../shaders/delay.js';
import { passthroughFrag } from '../shaders/passthrough.js';
import { vertSrc } from '../shaders/vert.js';
import { registerModule } from '../moduleRegistry.js';

export class DelayModule extends Module {
  constructor(glCanvas, id) {
    super('Delay', glCanvas, id);
    this.inputs = [{ name: 'in', type: 'video' }];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      delaySpeed: { value: 0.2, min: 0, max: 1, step: 0.01, label: 'Speed' },
      lumaThreshold: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Luma' },
      alphaMax: { value: 1, min: 0, max: 1, step: 0.01, label: 'A Max' },
      alphaMin: { value: 0.1, min: 0, max: 1, step: 0.01, label: 'A Min' },
    };
    this.createShader(delayFrag);
    this.createOutputFBO();
    this.feedbackFBO = glCanvas.createFramebuffer();
    this.copyShader = glCanvas.createShader(vertSrc, passthroughFrag);
  }

  process(graph, glCanvas) {
    const inputFBO = this.getInput(graph, 0);
    if (!inputFBO) return;

    // Render delay effect: blend current input with feedback
    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('tex0', inputFBO);
    this.shader.setUniform('tex1', this.feedbackFBO);
    this.shader.setUniform('delaySpeed', this.params.delaySpeed.value);
    this.shader.setUniform('lumaThreshold', this.params.lumaThreshold.value);
    this.shader.setUniform('alphaMax', this.params.alphaMax.value);
    this.shader.setUniform('alphaMin', this.params.alphaMin.value);
    this.renderQuad();
    this.outputFBO.end();

    // Copy output to feedback for next frame
    this.feedbackFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.copyShader);
    this.copyShader.setUniform('tex0', this.outputFBO);
    this.renderQuad();
    this.feedbackFBO.end();
  }

  dispose() {
    this.feedbackFBO = null;
    this.copyShader = null;
    super.dispose();
  }
}

registerModule('Delay', DelayModule);
