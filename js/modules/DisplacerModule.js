import { Module } from './Module.js';
import { displacerFrag } from '../shaders/displacer.js';
import { registerModule } from '../moduleRegistry.js';

// After Effects' "Use For Horizontal/Vertical Displacement" menu, in its order.
// Patches save the index, so new options go on the end.
const CHANNELS = ['Red', 'Green', 'Blue', 'Alpha', 'Luminance', 'Hue', 'Lightness', 'Saturation',
  'Full', 'Half', 'Off'];
const EDGES = ['Clamp', 'Wrap', 'Mirror', 'Black'];

export class DisplacerModule extends Module {
  static uid = 'a291a656';

  constructor(glCanvas, id) {
    super('Displacer', glCanvas, id);
    this.inputs = [
      { id: 'ab75', name: 'in', type: 'video' },
      { id: '3e00', name: 'map', type: 'video' },
    ];
    this.outputs = [{ id: 'c7b3', name: 'out', type: 'video' }];
    // Max displacements are in pixels of the logical frame, so +-640 and +-480
    // can push a pixel a whole frame width or height
    this.params = {
      xChannel: {
        id: 'd407', value: 0, min: 0, max: CHANNELS.length - 1, step: 1, label: 'X From',
        widget: 'dropdown', valueLabels: CHANNELS,
      },
      xMax: { id: '0705', value: 20, min: -640, max: 640, step: 1, label: 'X Max' },
      yChannel: {
        id: '3f5c', value: 1, min: 0, max: CHANNELS.length - 1, step: 1, label: 'Y From',
        widget: 'dropdown', valueLabels: CHANNELS,
      },
      yMax: { id: 'c16a', value: 20, min: -480, max: 480, step: 1, label: 'Y Max' },
      edges: {
        id: '176c', value: 0, min: 0, max: EDGES.length - 1, step: 1, label: 'Edges',
        widget: 'dropdown', valueLabels: EDGES,
      },
    };
    this.createShader(displacerFrag);
    this.createOutputFBO();
  }

  process(graph, glCanvas) {
    const input = this.getInput(graph, 0);
    const map = this.getInput(graph, 1);
    if (!input && !map) return;
    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    // A lone input feeds both, so on its own the video displaces itself
    this.shader.setUniform('tex0', input || map);
    this.shader.setUniform('tex1', map || input);
    this.shader.setUniform('uResolution', [glCanvas.width, glCanvas.height]);
    this.shader.setUniform('uXChannel', Math.round(this.params.xChannel.value));
    this.shader.setUniform('uYChannel', Math.round(this.params.yChannel.value));
    this.shader.setUniform('uMax', [this.params.xMax.value, this.params.yMax.value]);
    this.shader.setUniform('uEdges', Math.round(this.params.edges.value));
    this.renderQuad();
    this.outputFBO.end();
  }
}

registerModule('Displacer', DisplacerModule);
