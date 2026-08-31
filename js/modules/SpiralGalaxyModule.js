import { Module } from './Module.js';
import { spiralgalaxyFrag, spiralgalaxyBlendFrag } from '../shaders/spiralgalaxy.js';
import { vertSrc } from '../shaders/vert.js';
import { registerModule } from '../moduleRegistry.js';

// The whole animation repeats exactly every `loop` seconds.
//
// The tunnel is a feedback accumulation, so the loop can't be closed by simply
// rewinding the clock — the buffer would still hold the old state. Instead two
// independent feedback buffers ("worlds") run half a cycle out of phase. Each
// restarts from black once per cycle, at the exact moment its own blend weight
// is zero (and flat), so its restart is invisible. The output always shows a
// blend dominated by the mid-life world, and the frame at phase 1 matches the
// frame at phase 0.
const MAX_DT = 0.1;   // clamp long stalls so a tab switch doesn't jump the phase
const TAU = Math.PI * 2;

export class SpiralGalaxyModule extends Module {
  constructor(glCanvas, id) {
    super('SpiralGalaxy', glCanvas, id);
    this.inputs = [];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      loop: { value: 60, min: 5, max: 180, step: 1, label: 'Loop' },
      speed: { value: 0.5, min: 0, max: 3, step: 0.01, label: 'Speed' },
      trail: { value: 0.92, min: 0.7, max: 0.99, step: 0.005, label: 'Trail' },
      swirl: { value: 0.012, min: 0, max: 0.06, step: 0.001, label: 'Swirl' },
      ripple: { value: 0.4, min: 0, max: 1.5, step: 0.01, label: 'Ripple' },
    };

    this.createShader(spiralgalaxyFrag);
    this.blendShader = glCanvas.createShader(vertSrc, spiralgalaxyBlendFrag);
    this.createOutputFBO();

    // offset: where in the cycle this world restarts (0 = at phase 0, 0.5 = at phase 0.5)
    this.worlds = [this._makeWorld(0.0), this._makeWorld(0.5)];

    this.cycles = 0;
    this.lastTime = performance.now();
  }

  _makeWorld(offset) {
    return {
      offset,
      read: this.glCanvas.createFramebuffer(),
      draw: this.glCanvas.createFramebuffer(),
      age: 0,
      epoch: null,
    };
  }

  _clearFBO(fbo) {
    fbo.begin();
    this.glCanvas.clear();
    fbo.end();
  }

  // Restart a world: identical every cycle, so the loop closes exactly.
  _resetWorld(w) {
    this._clearFBO(w.read);
    this._clearFBO(w.draw);
  }

  _drawFeedback(w, glCanvas) {
    w.draw.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('u_prev', w.read);
    // World-local time: resets with the world, so it loops too
    this.shader.setUniform('u_time', w.age);
    this.shader.setUniform('uResolution', [glCanvas.width, glCanvas.height]);
    this.shader.setUniform('u_speed', this.params.speed.value);
    this.shader.setUniform('u_trail', this.params.trail.value);
    this.shader.setUniform('u_swirl', this.params.swirl.value);
    this.shader.setUniform('u_ripple', this.params.ripple.value);
    this.renderQuad();
    w.draw.end();
  }

  process(graph, glCanvas) {
    const loopSecs = this.params.loop.value;

    // Accumulate the phase rather than deriving it from an absolute clock, so
    // changing the loop length alters the rate without jumping the cycle.
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, MAX_DT);
    this.lastTime = now;
    this.cycles += dt / loopSecs;

    const phase = this.cycles - Math.floor(this.cycles);

    // Weight of world B. 1 at phase 0, 0 at phase 0.5, back to 1 at phase 1.
    // Its derivative is zero at both ends, so each world's restart — which
    // happens exactly where its own weight is 0 — is completely hidden.
    const mixB = 0.5 + 0.5 * Math.cos(phase * TAU);

    for (const w of this.worlds) {
      const u = this.cycles - w.offset;
      const epoch = Math.floor(u);
      w.age = (u - epoch) * loopSecs;

      if (epoch !== w.epoch) { w.epoch = epoch; this._resetWorld(w); }

      this._drawFeedback(w, glCanvas);
    }

    // Composite both worlds into the module output
    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.blendShader);
    this.blendShader.setUniform('tex0', this.worlds[0].draw);
    this.blendShader.setUniform('tex1', this.worlds[1].draw);
    this.blendShader.setUniform('u_mix', mixB);
    this.renderQuad();
    this.outputFBO.end();

    // Swap each world's read/draw buffers
    for (const w of this.worlds) { const r = w.read; w.read = w.draw; w.draw = r; }
  }

  dispose() {
    for (const w of this.worlds) { w.read = null; w.draw = null; }
    this.worlds = [];
    this.blendShader = null;
    super.dispose();
  }
}

registerModule('SpiralGalaxy', SpiralGalaxyModule);
