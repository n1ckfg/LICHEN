import { Module } from './Module.js';
import { channelFrag } from '../shaders/channel.js';
import { registerModule } from '../moduleRegistry.js';

// Builds a picture from three inputs' channels: red from r, green from g and
// blue from b, each times its gain. A negative gain inverts its channel. An
// unplugged channel is black, so a lone input shows only the channel of the
// pin it is on.
export class ChannelModule extends Module {
  static uid = '716017f8';

  constructor(glCanvas, id) {
    super('Channel', glCanvas, id);
    this.inputs = [
      { id: 'cd7f', name: 'r', type: 'video' },
      { id: '3652', name: 'g', type: 'video' },
      { id: '7c48', name: 'b', type: 'video' },
    ];
    this.outputs = [{ id: 'e90e', name: 'out', type: 'video' }];
    this.params = {
      gainR: { id: '1f27', value: 1, min: -3, max: 3, step: 0.01, label: 'R Gain' },
      gainG: { id: '7fb8', value: 1, min: -3, max: 3, step: 0.01, label: 'G Gain' },
      gainB: { id: 'cf3a', value: 1, min: -3, max: 3, step: 0.01, label: 'B Gain' },
    };
    this.createShader(channelFrag);
    this.createOutputFBO();
  }

  process(graph, glCanvas) {
    const inputs = [0, 1, 2].map((i) => this.getInput(graph, i));
    const plugged = inputs.filter(Boolean);
    if (plugged.length === 0) return;
    const gains = [this.params.gainR, this.params.gainG, this.params.gainB]
      .map((p, i) => (inputs[i] ? p.value : 0));

    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    // An unplugged channel's gain is 0, but its sampler still needs a texture
    this.shader.setUniform('texR', inputs[0] || plugged[0]);
    this.shader.setUniform('texG', inputs[1] || plugged[0]);
    this.shader.setUniform('texB', inputs[2] || plugged[0]);
    this.shader.setUniform('uGain', gains);
    this.renderQuad();
    this.outputFBO.end();
  }
}

registerModule('Channel', ChannelModule);
