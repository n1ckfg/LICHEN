import { Module } from './Module.js';
import { cloudyFrag } from '../shaders/cloudy.js';
import { registerModule } from '../moduleRegistry.js';

export class CloudyModule extends Module {
  static uid = '47bd99ea';

  constructor(glCanvas, id) {
    super('Cloudy', glCanvas, id);
    this.inputs = [];
    this.outputs = [{ id: '93e3', name: 'out', type: 'video' }];
    // `random` ranges keep a fresh seed away from the knobs' degenerate ends:
    // frozen at speed 0, and either end of depth, where the cloud flattens into
    // a white haze (-2) or sinks into the dark background (2).
    this.params = {
      speed: { id: '92da', value: 0.4, min: 0, max: 2, step: 0.01, label: 'Speed', random: [0.1, 1.2] },
      depth: { id: '10cf', value: -0.31, min: -2, max: 2, step: 0.01, label: 'Depth', random: [-1, 1.25] },
      wander: { id: '6360', value: 0.08, min: 0, max: 1, step: 0.01, label: 'Wander', random: [0, 0.5] },
      noiseScale: { id: 'ebe2', value: 2.5, min: 0.1, max: 8, step: 0.1, label: 'Noise', random: [1, 5] },
      displace: { id: '5369', value: 0.12, min: 0, max: 0.5, step: 0.01, label: 'Displace', random: [0.03, 0.35] },
      colorShift: { id: 'ba6e', value: 3.0, min: 0, max: 6.28, step: 0.01, label: 'Color', random: true },
      glow: { id: 'b791', value: 0.4, min: 0, max: 2, step: 0.01, label: 'Glow', random: [0.1, 1.2] },
      zoom: { id: '58e3', value: 1.0, min: 0.2, max: 4, step: 0.05, label: 'Zoom', random: [0.5, 2] },
      reseed: { id: 'b32b', value: 0, min: 0, max: 1, step: 1, label: 'Seed', widget: 'trigger' },
    };

    this.createShader(cloudyFrag);
    this.createOutputFBO();

    // Every new cloud starts from its own seed. Patch loads and duplicates
    // then restore the saved params and seed over this one.
    this.randomize();

    this.startTime = performance.now();
  }

  process(graph, glCanvas) {
    const elapsed = (performance.now() - this.startTime) / 1000;

    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('uTime', elapsed);
    this.shader.setUniform('uResolution', [glCanvas.width, glCanvas.height]);
    this.shader.setUniform('speed', this.params.speed.value);
    this.shader.setUniform('depth', this.params.depth.value);
    this.shader.setUniform('wander', this.params.wander.value);
    this.shader.setUniform('noiseScale', this.params.noiseScale.value);
    this.shader.setUniform('displace', this.params.displace.value);
    this.shader.setUniform('colorShift', this.params.colorShift.value);
    this.shader.setUniform('glow', this.params.glow.value);
    this.shader.setUniform('zoom', this.params.zoom.value);
    this.renderQuad();
    this.outputFBO.end();
  }

  onTrigger(name) {
    if (name === 'reseed') this.randomize();
  }

  triggerText(name) {
    return name === 'reseed' ? this.seed : '';
  }
}

registerModule('Cloudy', CloudyModule);
