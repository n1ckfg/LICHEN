import { Module } from './Module.js';
import { resizeFrag } from '../shaders/resize.js';
import { registerModule } from '../moduleRegistry.js';

// Scales its input to Width x Height real pixels, with the same knobs as Restore's
export class ResizeModule extends Module {
  static uid = '561cfb03';

  constructor(glCanvas, id) {
    super('Resize', glCanvas, id);
    this.inputs = [{ id: '36d0', name: 'in', type: 'video' }];
    this.outputs = [{ id: 'c684', name: 'out', type: 'video' }];
    this.params = {
      // The output's size in real pixels, as Monitor's. 0 is the input's own.
      width: { id: 'aed9', value: 0, min: 0, max: 3840, step: 160, label: 'Width', valueLabels: ['Input'] },
      height: { id: '3a30', value: 0, min: 0, max: 2160, step: 120, label: 'Height', valueLabels: ['Input'] },
    };
    this.createShader(resizeFrag);
    // Sized by _resize() when a frame comes in. Density 1, so its width and
    // height are real pixels.
    this.outputFBO = this.createFramebuffer({ width: glCanvas.width, height: glCanvas.height, density: 1 });
  }

  // Give the output Width x Height real pixels, where 0, or a negative size
  // typed in, is the input's own size. p5 cuts a size the GPU can't make.
  _resize(input) {
    const w = Math.max(0, Math.round(this.params.width.value)) || Math.round(input.width * input.density);
    const h = Math.max(0, Math.round(this.params.height.value)) || Math.round(input.height * input.density);
    const asked = `${w} x ${h}`;
    if (asked === this._asked) return;
    this._asked = asked;
    this.outputFBO.resize(w, h);
  }

  process(graph, glCanvas) {
    const inputFBO = this.getInput(graph, 0);
    if (!inputFBO) return;
    this._resize(inputFBO);

    // REPLACE so the input's alpha is copied, not blended over the clear; end()
    // pops the blend mode back
    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.blendMode(glCanvas.REPLACE);
    glCanvas.shader(this.shader);
    this.shader.setUniform('tex0', inputFBO);
    this.renderQuad();
    this.outputFBO.end();
  }
}

registerModule('Resize', ResizeModule);
