import { Module } from './Module.js';
import { vertSrc } from '../shaders/vert.js';
import { matteFrag, matteChokeFrag, MATTE_MAX_TAPS } from '../shaders/matte.js';
import { registerModule } from '../moduleRegistry.js';

export class MatteModule extends Module {
  static uid = '6013a1a6';

  constructor(glCanvas, id) {
    super('Matte', glCanvas, id);
    this.inputs = [
      { id: 'd2bc', name: 'fg', type: 'video' },
      { id: '97cb', name: 'a', type: 'video' },
      { id: '7ff6', name: 'bg', type: 'video' },
    ];
    this.outputs = [{ id: 'c028', name: 'out', type: 'video' }];
    this.params = {
      matte: {
        id: '5575', value: 0, min: 0, max: 1, step: 1, label: 'Matte', widget: 'dropdown',
        valueLabels: ['Alpha', 'Luma'],
      },
      mix: { id: '3d6d', value: 1, min: 0, max: 1, step: 0.01, label: 'Mix' },
      // Logical pixels: positive chokes the matte, negative spreads it
      choke: { id: '012e', value: 0, min: -20, max: 20, step: 0.1, label: 'Choke' },
    };
    this.createShader(matteFrag);
    this.createOutputFBO();
    this.chokeShader = glCanvas.createShader(vertSrc, matteChokeFrag);
    // The choke's working buffer, made the first time Choke leaves 0
    this.chokeFBO = null;
  }

  process(graph, glCanvas) {
    const fg = this.getInput(graph, 0);
    const a = this.getInput(graph, 1);
    const bg = this.getInput(graph, 2);
    if (!fg && !bg) return;
    // With no a, fg is its own matte. A lone bg has nothing over it, so it
    // passes through.
    const top = fg || bg;
    const src = a || top;
    const luma = Math.round(this.params.matte.value) === 1 ? 1 : 0;

    const choke = this.params.choke.value;
    const radius = Math.min(Math.abs(choke) * this.pixelDensity, MATTE_MAX_TAPS);
    const taps = Math.floor(radius);
    const frac = radius - taps;
    const sign = choke < 0 ? -1 : 1;
    const choked = Boolean(fg) && radius > 0;
    const [w, h] = this.fragResolution();

    if (choked) {
      this.chokeFBO ??= this.createFramebuffer();
      this.chokeFBO.begin();
      glCanvas.clear();
      glCanvas.shader(this.chokeShader);
      this.chokeShader.setUniform('tex0', src);
      this.chokeShader.setUniform('uLuma', luma);
      this.chokeShader.setUniform('uStep', [1 / w, 0]);
      this.chokeShader.setUniform('uTaps', taps);
      this.chokeShader.setUniform('uFrac', frac);
      this.chokeShader.setUniform('uSign', sign);
      this.renderQuad();
      this.chokeFBO.end();
    }

    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('tex0', top);
    this.shader.setUniform('tex1', bg || top);
    this.shader.setUniform('tex2', choked ? this.chokeFBO : src);
    this.shader.setUniform('uHasBg', bg ? 1 : 0);
    this.shader.setUniform('uChoked', choked ? 1 : 0);
    this.shader.setUniform('uLuma', luma);
    this.shader.setUniform('uStep', [0, 1 / h]);
    this.shader.setUniform('uTaps', taps);
    this.shader.setUniform('uFrac', frac);
    this.shader.setUniform('uSign', sign);
    this.shader.setUniform('uMix', this.params.mix.value);
    this.renderQuad();
    this.outputFBO.end();
  }

  dispose() {
    if (this.chokeFBO) this.chokeFBO.remove();
    this.chokeFBO = null;
    this.chokeShader = null;
    super.dispose();
  }
}

registerModule('Matte', MatteModule);
