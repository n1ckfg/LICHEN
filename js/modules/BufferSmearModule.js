import { Module } from './Module.js';
import { bufferSmearFrag } from '../shaders/buffer-smear.js';
import { passthroughFrag } from '../shaders/passthrough.js';
import { vertSrc } from '../shaders/vert.js';
import { registerModule } from '../moduleRegistry.js';

export class BufferSmearModule extends Module {
  constructor(glCanvas, id) {
    super('BufferSmear', glCanvas, id);
    this.inputs = [{ name: 'in', type: 'video' }];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      smearAmount: { value: 1.0, min: 0, max: 5, step: 0.01, label: 'Smear' },
      feedback: { value: 0.96, min: 0, max: 1, step: 0.01, label: 'Feedback' },
      zoomSpeed: { value: 1.0, min: 0, max: 5, step: 0.01, label: 'Zoom' },
    };
    this.createShader(bufferSmearFrag);
    this.createOutputFBO();
    this.feedbackFBO = glCanvas.createFramebuffer();
    this.copyShader = glCanvas.createShader(vertSrc, passthroughFrag);
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
    this.shader.setUniform('tex1', this.feedbackFBO);
    this.shader.setUniform('time', time);
    this.shader.setUniform('smearAmount', this.params.smearAmount.value);
    this.shader.setUniform('feedback', this.params.feedback.value);
    this.shader.setUniform('zoomSpeed', this.params.zoomSpeed.value);
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

registerModule('BufferSmear', BufferSmearModule);
