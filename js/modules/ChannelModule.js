import { Module } from './Module.js';
import { channelFrag } from '../shaders/channel.js';
import { registerModule } from '../moduleRegistry.js';

// Builds a picture from three inputs' channels: red from r, green from g and
// blue from b, each times its gain. A lone input feeds all three, as
// VideoMixer's feeds both of its, so Channel then sets one picture's channel
// gains. With two or three plugged in, an unplugged channel is black.
export class ChannelModule extends Module {
  constructor(glCanvas, id) {
    super('Channel', glCanvas, id);
    this.inputs = [
      { name: 'r', type: 'video' },
      { name: 'g', type: 'video' },
      { name: 'b', type: 'video' },
    ];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      gainR: { value: 1, min: 0, max: 3, step: 0.01, label: 'R Gain' },
      gainG: { value: 1, min: 0, max: 3, step: 0.01, label: 'G Gain' },
      gainB: { value: 1, min: 0, max: 3, step: 0.01, label: 'B Gain' },
    };
    this.createShader(channelFrag);
    this.createOutputFBO();
  }

  process(graph, glCanvas) {
    const inputs = [0, 1, 2].map((i) => this.getInput(graph, i));
    const plugged = inputs.filter(Boolean);
    if (plugged.length === 0) return;
    const lone = plugged.length === 1 ? plugged[0] : null;
    const sources = inputs.map((input) => lone || input);
    const gains = [this.params.gainR, this.params.gainG, this.params.gainB]
      .map((p, i) => (sources[i] ? p.value : 0));

    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    // An unplugged channel's gain is 0, but its sampler still needs a texture
    this.shader.setUniform('texR', sources[0] || plugged[0]);
    this.shader.setUniform('texG', sources[1] || plugged[0]);
    this.shader.setUniform('texB', sources[2] || plugged[0]);
    this.shader.setUniform('uGain', gains);
    this.renderQuad();
    this.outputFBO.end();
  }
}

registerModule('Channel', ChannelModule);
