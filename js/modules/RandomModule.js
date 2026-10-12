import { Module } from './Module.js';
import { registerModule } from '../moduleRegistry.js';

// A sample-and-hold random source: a new value between Min and Max, Hz times a
// second, on a control output. It is plain JS, with no shader, framebuffer or
// preview (see Control Modules in ARCHITECTURE.md).
export class RandomModule extends Module {
  static uid = '2f360cda';

  constructor(glCanvas, id) {
    super('Random', glCanvas, id);
    this.outputs = [{ id: '0334', name: 'out', type: 'control' }];
    this.params = {
      min: { id: '4257', value: 0, min: 0, max: 1, step: 0.01, label: 'Min' },
      max: { id: '4d15', value: 1, min: 0, max: 1, step: 0.01, label: 'Max' },
      // New values a second. A control output carries one value a frame, so
      // above the frame rate it is a new one every frame. 0 holds the last
      hz: { id: '5b36', value: 60, min: 0, max: 120, step: 0.1, label: 'Hz' },
    };

    // The draw is kept as 0..1 and scaled on the way out, so the output stays
    // between Min and Max while they move, even while Hz holds it
    this.unit = Math.random();
    // Updates due. It is accumulated, so turning Hz doesn't jump the rate
    this.phase = 0;
    this.lastTime = performance.now() / 1000;
  }

  process(graph, glCanvas) {
    const now = performance.now() / 1000;
    const dt = Math.max(now - this.lastTime, 0);
    this.lastTime = now;

    // However many updates came due this frame, one draw stands for them all.
    // The fraction left over carries on, so the rate holds on average
    this.phase += dt * this.params.hz.value;
    if (this.phase >= 1) {
      this.phase %= 1;
      this.unit = Math.random();
    }

    const { min, max } = this.params;
    this.controlValues.out = min.value + this.unit * (max.value - min.value);
  }
}

registerModule('Random', RandomModule);
