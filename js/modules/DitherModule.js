import { Module } from './Module.js';
import { ditherFrag, ditherErrorInitFrag, ditherErrorDiffuseFrag, ditherErrorRenderFrag } from '../shaders/dither.js';
import { registerModule } from '../moduleRegistry.js';

export class DitherModule extends Module {
  constructor(glCanvas, id) {
    super('Dither', glCanvas, id);
    this.inputs = [{ name: 'in', type: 'video' }];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      mode: { value: 0, min: 0, max: 2, step: 1, label: 'Mode' },
      levels: { value: 2, min: 2, max: 16, step: 1, label: 'Levels' },
      ditherStrength: { value: 1.0, min: 0, max: 2, step: 0.01, label: 'Strength' },
      passes: { value: 4, min: 1, max: 8, step: 1, label: 'Passes' },
    };

    // Main shader for modes 0 and 1
    this.createShader(ditherFrag);
    this.createOutputFBO();

    // Error diffusion shaders for mode 2
    this.errorInitShader = glCanvas.createShader(this._getVertSrc(), ditherErrorInitFrag);
    this.errorDiffuseShader = glCanvas.createShader(this._getVertSrc(), ditherErrorDiffuseFrag);
    this.errorRenderShader = glCanvas.createShader(this._getVertSrc(), ditherErrorRenderFrag);

    // Ping-pong FBOs for error diffusion
    this.fboA = glCanvas.createFramebuffer();
    this.fboB = glCanvas.createFramebuffer();
    this.originalFBO = glCanvas.createFramebuffer();
  }

  _getVertSrc() {
    return `
      precision highp float;
      attribute vec3 aPosition;
      attribute vec2 aTexCoord;
      varying vec2 vTexCoord;
      void main() {
        vTexCoord = aTexCoord;
        vec4 positionVec4 = vec4(aPosition, 1.0);
        positionVec4.xy = positionVec4.xy * 2.0 - 1.0;
        gl_Position = positionVec4;
      }
    `;
  }

  process(graph, glCanvas) {
    const inputFBO = this.getInput(graph, 0);
    if (!inputFBO) return;

    const mode = Math.floor(this.params.mode.value);

    if (mode < 2) {
      // Mode 0 (Bayer) or Mode 1 (Blue Noise) - single pass
      this.outputFBO.begin();
      glCanvas.clear();
      glCanvas.shader(this.shader);
      this.shader.setUniform('tex0', inputFBO);
      this.shader.setUniform('levels', this.params.levels.value);
      this.shader.setUniform('ditherStrength', this.params.ditherStrength.value);
      this.shader.setUniform('mode', this.params.mode.value);
      this.shader.setUniform('uResolution', [glCanvas.width, glCanvas.height]);
      this.renderQuad();
      this.outputFBO.end();
    } else {
      // Mode 2: Multi-pass error diffusion
      this._processErrorDiffusion(inputFBO, glCanvas);
    }
  }

  _processErrorDiffusion(inputFBO, glCanvas) {
    const numPasses = Math.floor(this.params.passes.value);

    // Store original input
    this.originalFBO.begin();
    glCanvas.clear();
    glCanvas.image(inputFBO, -glCanvas.width/2, -glCanvas.height/2, glCanvas.width, glCanvas.height);
    this.originalFBO.end();

    // Initial pass: quantize and calculate error
    this.fboA.begin();
    glCanvas.clear();
    glCanvas.shader(this.errorInitShader);
    this.errorInitShader.setUniform('tex0', inputFBO);
    this.errorInitShader.setUniform('levels', this.params.levels.value);
    this.errorInitShader.setUniform('uResolution', [glCanvas.width, glCanvas.height]);
    this.renderQuad();
    this.fboA.end();

    // Diffusion passes
    let readFBO = this.fboA;
    let writeFBO = this.fboB;

    for (let i = 0; i < numPasses; i++) {
      writeFBO.begin();
      glCanvas.clear();
      glCanvas.shader(this.errorDiffuseShader);
      this.errorDiffuseShader.setUniform('tex0', readFBO);
      this.errorDiffuseShader.setUniform('texOriginal', this.originalFBO);
      this.errorDiffuseShader.setUniform('levels', this.params.levels.value);
      this.errorDiffuseShader.setUniform('ditherStrength', this.params.ditherStrength.value);
      this.errorDiffuseShader.setUniform('uResolution', [glCanvas.width, glCanvas.height]);
      this.errorDiffuseShader.setUniform('passIndex', i);
      this.renderQuad();
      writeFBO.end();

      // Swap buffers
      const temp = readFBO;
      readFBO = writeFBO;
      writeFBO = temp;
    }

    // Final render pass
    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.errorRenderShader);
    this.errorRenderShader.setUniform('tex0', readFBO);
    this.renderQuad();
    this.outputFBO.end();
  }

  dispose() {
    this.fboA = null;
    this.fboB = null;
    this.originalFBO = null;
    this.errorInitShader = null;
    this.errorDiffuseShader = null;
    this.errorRenderShader = null;
    super.dispose();
  }
}

registerModule('Dither', DitherModule);
