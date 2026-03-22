import { Module } from './Module.js';
import { deeSeventySixFrag, deeSeventySixAccumFrag } from '../shaders/dee-seventy-six.js';
import { passthroughFrag } from '../shaders/passthrough.js';
import { vertSrc } from '../shaders/vert.js';
import { registerModule } from '../moduleRegistry.js';

export class DeeSeventySixModule extends Module {
  constructor(glCanvas, id) {
    super('DeeSeventySix', glCanvas, id);
    this.inputs = [{ name: 'in', type: 'video' }];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      grainScale: { value: 100, min: 10, max: 500, step: 1, label: 'Grain' },
      solarizeLimit: { value: 90, min: 1, max: 200, step: 1, label: 'Solarize' },
      fadeAmount: { value: 0.02, min: 0, max: 0.1, step: 0.001, label: 'Fade' },
      progressSpeed: { value: 0.005, min: 0, max: 0.05, step: 0.001, label: 'Speed' },
      isColor: { value: 1, min: 0, max: 1, step: 1, label: 'Color' },
    };
    this.createShader(deeSeventySixFrag);
    this.createOutputFBO();
    this.accumFBO = glCanvas.createFramebuffer();
    this.grainFBO = glCanvas.createFramebuffer();
    this.accumShader = glCanvas.createShader(vertSrc, deeSeventySixAccumFrag);
    this.copyShader = glCanvas.createShader(vertSrc, passthroughFrag);
    this.progress = 0;
    this.frameCount = 0;
    this.initialized = false;
  }

  process(graph, glCanvas) {
    const inputFBO = this.getInput(graph, 0);
    if (!inputFBO) return;

    // Initialize accumulation buffer to white on first frame
    if (!this.initialized) {
      this.accumFBO.begin();
      glCanvas.background(255);
      this.accumFBO.end();
      this.initialized = true;
    }

    this.progress += this.params.progressSpeed.value;
    if (this.progress > 1.0) this.progress = 1.0;
    this.frameCount++;

    // Render current frame's grain exposure to grain buffer
    this.grainFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('tex0', inputFBO);
    this.shader.setUniform('uResolution', [glCanvas.width, glCanvas.height]);
    this.shader.setUniform('progress', Math.min(this.progress, 1.0));
    this.shader.setUniform('grainScale', this.params.grainScale.value);
    this.shader.setUniform('solarizeLimit', this.params.solarizeLimit.value);
    this.shader.setUniform('frame', this.frameCount);
    this.shader.setUniform('isColor', this.params.isColor.value > 0.5);
    this.renderQuad();
    this.grainFBO.end();

    // Accumulate: multiply new grain onto faded accumulation buffer
    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.accumShader);
    this.accumShader.setUniform('tex0', this.grainFBO);
    this.accumShader.setUniform('tex1', this.accumFBO);
    this.accumShader.setUniform('fadeAmount', this.params.fadeAmount.value);
    this.renderQuad();
    this.outputFBO.end();

    // Copy output to accumulation buffer for next frame
    this.accumFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.copyShader);
    this.copyShader.setUniform('tex0', this.outputFBO);
    this.renderQuad();
    this.accumFBO.end();
  }

  reset() {
    this.progress = 0;
    this.initialized = false;
  }

  dispose() {
    this.accumFBO = null;
    this.grainFBO = null;
    this.accumShader = null;
    this.copyShader = null;
    super.dispose();
  }
}

registerModule('DeeSeventySix', DeeSeventySixModule);
