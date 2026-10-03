import { Module } from './Module.js';
import { ditherFrag, ditherErrorInitFrag, ditherErrorDiffuseFrag } from '../shaders/dither.js';
import { registerModule } from '../moduleRegistry.js';

export class DitherModule extends Module {
  constructor(glCanvas, id) {
    super('Dither', glCanvas, id);
    this.inputs = [{ name: 'in', type: 'video' }];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      mode: {
        value: 0, min: 0, max: 2, step: 1, label: 'Mode', widget: 'dropdown',
        valueLabels: ['Bayer', 'Blue Noise', 'Error Diffusion'],
      },
      // Grey by default, so patches saved before RGB existed still dither in grey
      color: {
        value: 0, min: 0, max: 1, step: 1, label: 'Color', widget: 'dropdown',
        valueLabels: ['Grey', 'RGB'],
      },
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

    // Ping-pong FBOs for error diffusion
    this.fboA = glCanvas.createFramebuffer();
    this.fboB = glCanvas.createFramebuffer();
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

    // Rounded, like the dropdown's label, so a control cable can't land between modes
    const mode = Math.round(this.params.mode.value);
    const grey = Math.round(this.params.color.value) === 0 ? 1 : 0;

    if (mode < 2) {
      // Mode 0 (Bayer) or Mode 1 (Blue Noise) - single pass
      this.outputFBO.begin();
      glCanvas.clear();
      glCanvas.shader(this.shader);
      this.shader.setUniform('tex0', inputFBO);
      this.shader.setUniform('levels', this.params.levels.value);
      this.shader.setUniform('ditherStrength', this.params.ditherStrength.value);
      this.shader.setUniform('mode', mode);
      this.shader.setUniform('uGrey', grey);
      this.shader.setUniform('uResolution', this.fragResolution());
      this.renderQuad();
      this.outputFBO.end();
    } else {
      // Mode 2: Multi-pass error diffusion
      this._processErrorDiffusion(inputFBO, glCanvas, grey);
    }
  }

  _processErrorDiffusion(inputFBO, glCanvas, grey) {
    // At least one pass, since the last one is what writes outputFBO
    const numPasses = Math.max(1, Math.floor(this.params.passes.value));

    // Every pass reads the original colour straight from inputFBO. Don't copy it
    // with glCanvas.image(): p5 draws that through whatever shader is bound if it has
    // a sampler (the UI's blit shader, left bound between frames), not the image.

    // Initial pass: quantize and calculate error
    this.fboA.begin();
    glCanvas.clear();
    glCanvas.shader(this.errorInitShader);
    this.errorInitShader.setUniform('tex0', inputFBO);
    this.errorInitShader.setUniform('levels', this.params.levels.value);
    this.errorInitShader.setUniform('uGrey', grey);
    this.errorInitShader.setUniform('uResolution', this.fragResolution());
    this.renderQuad();
    this.fboA.end();

    // Diffusion passes. The ping-pong buffers hold each channel's error in RGB, with
    // no room left for the quantized colour, so the last pass writes that colour
    // straight into outputFBO instead.
    let readFBO = this.fboA;
    let writeFBO = this.fboB;

    for (let i = 0; i < numPasses; i++) {
      const final = i === numPasses - 1;
      const target = final ? this.outputFBO : writeFBO;
      target.begin();
      glCanvas.clear();
      glCanvas.shader(this.errorDiffuseShader);
      this.errorDiffuseShader.setUniform('tex0', readFBO);
      this.errorDiffuseShader.setUniform('texOriginal', inputFBO);
      this.errorDiffuseShader.setUniform('levels', this.params.levels.value);
      this.errorDiffuseShader.setUniform('uGrey', grey);
      this.errorDiffuseShader.setUniform('ditherStrength', this.params.ditherStrength.value);
      this.errorDiffuseShader.setUniform('uResolution', this.fragResolution());
      this.errorDiffuseShader.setUniform('passIndex', i);
      this.errorDiffuseShader.setUniform('uFinal', final ? 1 : 0);
      this.renderQuad();
      target.end();

      // Swap buffers
      const temp = readFBO;
      readFBO = writeFBO;
      writeFBO = temp;
    }
  }

  dispose() {
    this.fboA = null;
    this.fboB = null;
    this.errorInitShader = null;
    this.errorDiffuseShader = null;
    super.dispose();
  }
}

registerModule('Dither', DitherModule);
