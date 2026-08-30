import { Module } from './Module.js';
import { cloudyFrag } from '../shaders/cloudy.js';
import { registerModule } from '../moduleRegistry.js';

export class CloudyModule extends Module {
  constructor(glCanvas, id) {
    super('Cloudy', glCanvas, id);
    this.inputs = [];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      speed: { value: 0.4, min: 0, max: 2, step: 0.01, label: 'Speed' },
      blobs: { value: 12, min: 1, max: 16, step: 1, label: 'Blobs' },
      smoothness: { value: 0.5, min: 0.05, max: 2, step: 0.01, label: 'Smooth' },
      noiseScale: { value: 2.5, min: 0.1, max: 8, step: 0.1, label: 'Noise' },
      displace: { value: 0.12, min: 0, max: 0.5, step: 0.01, label: 'Displace' },
      colorShift: { value: 3.0, min: 0, max: 6.28, step: 0.01, label: 'Color' },
      glow: { value: 0.4, min: 0, max: 2, step: 0.01, label: 'Glow' },
      zoom: { value: 1.0, min: 0.2, max: 4, step: 0.05, label: 'Zoom' },
    };

    this.createShader(cloudyFrag);
    this.createOutputFBO();
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
    this.shader.setUniform('blobs', this.params.blobs.value);
    this.shader.setUniform('smoothness', this.params.smoothness.value);
    this.shader.setUniform('noiseScale', this.params.noiseScale.value);
    this.shader.setUniform('displace', this.params.displace.value);
    this.shader.setUniform('colorShift', this.params.colorShift.value);
    this.shader.setUniform('glow', this.params.glow.value);
    this.shader.setUniform('zoom', this.params.zoom.value);
    this.renderQuad();
    this.outputFBO.end();
  }
}

registerModule('Cloudy', CloudyModule);
