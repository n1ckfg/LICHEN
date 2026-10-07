import { Module } from './Module.js';
import { videoMixerFrag } from '../shaders/video-mixer.js';
import { registerModule } from '../moduleRegistry.js';

export class VideoMixerModule extends Module {
  constructor(glCanvas, id) {
    super('VideoMixer', glCanvas, id);
    this.inputs = [
      { name: 'A', type: 'video' },
      { name: 'B', type: 'video' },
    ];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      mode: {
        // Patches save the index, so new modes go on the end
        value: 0, min: 0, max: 11, step: 1, label: 'Mode', widget: 'dropdown',
        valueLabels: ['Blend', 'Add', 'Subtract', 'Multiply', 'Divide', 'Lighten', 'Darken', 'Difference',
          'Color', 'Overlay', 'Saturation', 'Luminance'],
      },
      mix: { value: 1.0, min: 0, max: 1, step: 0.01, label: 'Mix' },
    };
    this.createShader(videoMixerFrag);
    this.createOutputFBO();
  }

  process(graph, glCanvas) {
    const inputA = this.getInput(graph, 0);
    const inputB = this.getInput(graph, 1);
    if (!inputA && !inputB) return;
    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('tex0', inputA || inputB);
    this.shader.setUniform('tex1', inputB || inputA);
    this.shader.setUniform('mix_amount', this.params.mix.value);
    this.shader.setUniform('mode', Math.round(this.params.mode.value));
    this.renderQuad();
    this.outputFBO.end();
  }
}

registerModule('VideoMixer', VideoMixerModule);
