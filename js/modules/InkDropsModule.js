import { Module } from './Module.js';
import { inkDropsFrag } from '../shaders/inkdrops.js';
import { registerModule } from '../moduleRegistry.js';

const MAX_DT = 0.1;      // clamp long stalls so a tab switch doesn't jump the clock
const NO_CLICK = -1e6;   // far enough in the past that the click drop has faded

export class InkDropsModule extends Module {
  constructor(glCanvas, id) {
    super('InkDrops', glCanvas, id);
    this.inputs = [];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      drops: { value: 8, min: 1, max: 8, step: 1, label: 'Drops' },
      life: { value: 18, min: 4, max: 40, step: 0.5, label: 'Life' },
      speed: { value: 1.0, min: 0, max: 3, step: 0.01, label: 'Speed' },
      spread: { value: 0.3, min: 0.05, max: 0.6, step: 0.01, label: 'Spread' },
      wobble: { value: 1.0, min: 0, max: 3, step: 0.01, label: 'Wobble' },
      grain: { value: 1.0, min: 0, max: 3, step: 0.01, label: 'Grain' },
    };

    this.createShader(inkDropsFrag);
    this.createOutputFBO();

    // Scaled time is accumulated rather than derived from an absolute clock, so
    // turning the speed knob changes the rate without jumping the animation.
    this.time = 0;
    this.lastTime = performance.now();
    this.clickTime = NO_CLICK;
    this.clickPos = [0, 0];
  }

  process(graph, glCanvas) {
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, MAX_DT);
    this.lastTime = now;
    this.time += dt * this.params.speed.value;

    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('uResolution', [glCanvas.width, glCanvas.height]);
    this.shader.setUniform('u_time', this.time);
    this.shader.setUniform('u_click', this.clickPos);
    this.shader.setUniform('u_click_t', this.clickTime);
    this.shader.setUniform('u_drops', this.params.drops.value);
    this.shader.setUniform('u_life', this.params.life.value);
    this.shader.setUniform('u_spread', this.params.spread.value);
    this.shader.setUniform('u_wobble', this.params.wobble.value);
    this.shader.setUniform('u_grain', this.params.grain.value);
    this.renderQuad();
    this.outputFBO.end();
  }

  // Map a click on the fullscreen canvas to a pixel position in the module's
  // own 4:3 output, accounting for the letterboxing. Same fit as Conway.
  getPixelPos(canvasX, canvasY, canvasW, canvasH) {
    const aspect = this.glCanvas.width / this.glCanvas.height;
    let dw = canvasW;
    let dh = canvasW / aspect;
    if (dh > canvasH) {
      dh = canvasH;
      dw = canvasH * aspect;
    }
    const dx = (canvasW - dw) / 2;
    const dy = (canvasH - dh) / 2;
    return [
      ((canvasX - dx) / dw) * this.glCanvas.width,
      ((canvasY - dy) / dh) * this.glCanvas.height,
    ];
  }

  // Fullscreen only: drop ink where the user clicks. ESC exits fullscreen.
  handleMouseDown(mx, my, canvasW, canvasH) {
    this.clickPos = this.getPixelPos(mx, my, canvasW, canvasH);
    this.clickTime = this.time;
  }
}

registerModule('InkDrops', InkDropsModule);
