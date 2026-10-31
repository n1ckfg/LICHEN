import { Module } from './Module.js';
import { resampleFrag } from '../shaders/resample.js';
import { registerModule } from '../moduleRegistry.js';

// How the input is fitted to Width x Height, in drop-down order. Patches save
// the mode as its index, so append, never insert.
const FIT = 0;          // stretched to fill
const LETTERBOX = 1;    // its shape kept, as wide as the output
const PILLARBOX = 2;    // its shape kept, as tall as the output

// Resamples its input to Width x Height real pixels, with the same knobs as Restore's
export class ResampleModule extends Module {
  static uid = '561cfb03';

  constructor(glCanvas, id) {
    super('Resample', glCanvas, id);
    this.inputs = [{ id: '36d0', name: 'in', type: 'video' }];
    this.outputs = [{ id: 'c684', name: 'out', type: 'video' }];
    this.params = {
      // The output's size in real pixels, as Monitor's. 0 is the input's own.
      width: { id: 'aed9', value: 0, min: 0, max: 3840, step: 160, label: 'Width', valueLabels: ['Input'] },
      height: { id: '3a30', value: 0, min: 0, max: 2160, step: 120, label: 'Height', valueLabels: ['Input'] },
      mode: {
        id: '6d36', value: FIT, min: 0, max: 2, step: 1, label: 'Mode', widget: 'dropdown',
        valueLabels: ['Fit', 'Letterbox', 'Pillarbox'],
      },
    };
    this.createShader(resampleFrag);
    // Sized by _resize() when a frame comes in. Density 1, so its width and
    // height are real pixels. NEAREST, so whatever reads it sees its pixels as
    // blocks, and a small size looks it, rather than blurring.
    this.outputFBO = this.createFramebuffer({
      width: glCanvas.width, height: glCanvas.height, density: 1, textureFiltering: glCanvas.NEAREST,
    });
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

  // The output's size over the picture's, on each axis: 1 fills that axis,
  // more than 1 leaves bars, less than 1 crops
  _scale(input) {
    const mode = Math.round(this.params.mode.value);
    if (mode !== LETTERBOX && mode !== PILLARBOX) return [1, 1];
    const out = this.outputFBO;
    // Aspects in real pixels; the output's density is 1
    const outAspect = out.width / out.height;
    const inAspect = input.width / input.height;
    return mode === LETTERBOX ? [1, inAspect / outAspect] : [outAspect / inAspect, 1];
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
    this.shader.setUniform('uScale', this._scale(inputFBO));
    this.renderQuad();
    this.outputFBO.end();
  }
}

registerModule('Resample', ResampleModule);
