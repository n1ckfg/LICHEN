import { Module } from './Module.js';
import { vertSrc } from '../shaders/vert.js';
import {
  protozoaInjectFrag,
  protozoaDiffuseFrag,
  protozoaBleedFrag,
  protozoaFeedbackFrag,
  protozoaBandingFrag,
  protozoaDisplayFrag,
  protozoaMeanFrag,
  protozoaSceneFrag,
  PROTO_MAX_CELLS,
  PROTO_SIM_SHORT,
  PROTO_SIM_LONG_MAX,
  PROTO_SEG_LAG,
  PROTO_SEG_LEN,
} from '../shaders/protozoa.js';
import { registerModule } from '../moduleRegistry.js';

const MAX_DT = 1 / 30;    // clamp long stalls so a tab switch doesn't jump the clocks
const MEAN_CELLS = 8;     // first reduction stage: MEAN_CELLS x MEAN_CELLS texels

// Held constant rather than exposed. The gamma has one safe side (see the
// diffuse pass), the fibre frequency is tied to the sim resolution, and the
// wash is the colour the swamp itself is built from.
const PIGMENT_GAMMA = 1.0;
const PAPER_FREQ = 0.32;                 // fibre cycles per texel (~3 texels per cycle)
const WASH = [0.015, 0.022, 0.012];      // colour the field decays into

// Colony palette: algae, chartreuse rot, ochre, rust, stagnant teal, duckweed
const PALETTE = [
  [0.16, 0.42, 0.10],
  [0.34, 0.46, 0.06],
  [0.42, 0.26, 0.05],
  [0.30, 0.11, 0.04],
  [0.06, 0.34, 0.28],
  [0.24, 0.40, 0.16],
];

const AMBIENT = 14;                  // free-drifting colonies
const TRAIL_SEGS = [0, 3, 6, 9];     // which body segments emit
const SNAKE_SEEDS = [0.0, 1.0];

export class ProtozoaModule extends Module {
  constructor(glCanvas, id) {
    super('Protozoa', glCanvas, id);
    this.inputs = [];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      speed: { value: 1.0, min: 0, max: 3, step: 0.01, label: 'Speed' },
      motion: { value: 0.34, min: 0, max: 2, step: 0.01, label: 'Motion' },
      deposit: { value: 5.0, min: 0, max: 15, step: 0.1, label: 'Deposit' },
      diffusion: { value: 0.10, min: 0, max: 0.5, step: 0.01, label: 'Diffusion' },
      bleed: { value: 0.95, min: 0, max: 1, step: 0.01, label: 'Bleed' },
      feedback: { value: 0.997, min: 0.9, max: 1, step: 0.001, label: 'Feedback' },
      banding: { value: 0.30, min: 0, max: 1, step: 0.01, label: 'Banding' },
      dry: { value: 0.03, min: 0, max: 0.2, step: 0.005, label: 'Dry' },
      gain: { value: 1.0, min: 0, max: 3, step: 0.01, label: 'Gain' },
    };

    this.injectShader = glCanvas.createShader(vertSrc, protozoaInjectFrag);
    this.diffuseShader = glCanvas.createShader(vertSrc, protozoaDiffuseFrag);
    this.bleedShader = glCanvas.createShader(vertSrc, protozoaBleedFrag);
    this.feedbackShader = glCanvas.createShader(vertSrc, protozoaFeedbackFrag);
    this.bandingShader = glCanvas.createShader(vertSrc, protozoaBandingFrag);
    this.displayShader = glCanvas.createShader(vertSrc, protozoaDisplayFrag);
    this.meanShader = glCanvas.createShader(vertSrc, protozoaMeanFrag);
    this.sceneShader = glCanvas.createShader(vertSrc, protozoaSceneFrag);

    // The sim's SHORT axis is pinned and the long axis follows the aspect
    // ratio. Diffusion, fibre bleed and the ripple displacement are all
    // texel-stencil operations, so a texel has to be a fixed fraction of the
    // frame or the field spreads at a different rate in every canvas shape.
    // Pinning it also keeps the per-frame cost off the output resolution: six
    // full-size passes would be wasteful, and the field is soft enough that
    // the upsample into the scene is free.
    const [simW, simH] = this._simSize(glCanvas);
    this.simW = simW;
    this.simH = simH;
    this.simRes = [simW, simH];

    this.hasFloat = this._detectFloat(glCanvas);
    this.state = [this._createRT(simW, simH), this._createRT(simW, simH)];
    this.disp = [this._createRT(simW, simH), this._createRT(simW, simH)];
    this.meanA = this._createRT(MEAN_CELLS, MEAN_CELLS);
    this.meanB = this._createRT(1, 1);
    this.dispCur = 0;

    for (const rt of [this.state[0], this.state[1], this.disp[0], this.disp[1]]) {
      rt.begin();
      glCanvas.clear();
      rt.end();
    }

    this.createOutputFBO();

    // Uniform staging, reused every frame
    this.posArr = new Float32Array(PROTO_MAX_CELLS * 2);
    this.colArr = new Float32Array(PROTO_MAX_CELLS * 3);
    this.radArr = new Float32Array(PROTO_MAX_CELLS);

    // Ambient drifters wander the frame on deterministic sinusoidal paths;
    // trail emitters ride the snake bodies. Built once, so a patch reloads to
    // the same arrangement.
    this.drifters = [];
    for (let i = 0; i < AMBIENT; i++) {
      const s = i * 2.399963;   // golden-angle spread
      this.drifters.push({
        col: PALETTE[i % PALETTE.length],
        seed: s,
        sx: 0.040 + (i % 5) * 0.011,
        sy: 0.034 + (i % 7) * 0.009,
        sx2: 0.085 + (i % 3) * 0.019,
        sy2: 0.071 + (i % 4) * 0.015,
        rad: 0.035 + (i % 6) * 0.017,
        pr: 0.16 + (i % 9) * 0.03,
        amp: 0.9 + (i % 5) * 0.12,
      });
    }

    // Both clocks are accumulated rather than scaled from an absolute time, so
    // turning Speed or Motion changes the rate without jumping the animation.
    this.time = 0;
    this.ftime = 0;
    this.lastTime = performance.now() / 1000;
  }

  _simSize(glCanvas) {
    const w = glCanvas.width, h = glCanvas.height;
    const long = Math.min(PROTO_SIM_LONG_MAX,
      Math.round(PROTO_SIM_SHORT * Math.max(w, h) / Math.min(w, h)));
    const portrait = h > w;
    return [
      Math.max(2, portrait ? PROTO_SIM_SHORT : long),
      Math.max(2, portrait ? long : PROTO_SIM_SHORT),
    ];
  }

  // Half-float keeps the watercolour feedback loop from banding out, and gives
  // the reduced mean density enough resolution to steer the auto-exposure.
  _detectFloat(glCanvas) {
    const gl = glCanvas.drawingContext;
    const webgl2 = glCanvas._renderer && glCanvas._renderer.webglVersion === 'webgl2';
    return !!(webgl2 && gl && gl.getExtension &&
      (gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float')));
  }

  _createRT(w, h) {
    const g = this.glCanvas;
    const opts = { width: w, height: h, density: 1, channels: g.RGBA };
    if (this.hasFloat) {
      try {
        return g.createFramebuffer(Object.assign({ format: g.HALF_FLOAT }, opts));
      } catch (e) {
        this.hasFloat = false;
      }
    }
    return g.createFramebuffer(opts);
  }

  // One full-screen pass into `target`. REPLACE because the display pass writes
  // meaningful alpha (the pigment density the reduction reads), which p5's
  // default blend would otherwise fold into the colour; end() pops it back.
  _pass(shader, target, setup) {
    const g = this.glCanvas;
    target.begin();
    g.clear();
    g.blendMode(g.REPLACE);
    g.shader(shader);
    setup(shader);
    this.renderQuad();
    target.end();
  }

  // Scene space -> field uv. Inverts the scene shader's
  // uv = (suv - 0.5) * res / min(res) * 1.5.
  _sceneToUV(x, y) {
    const w = this.glCanvas.width, h = this.glCanvas.height;
    const m = Math.min(w, h);
    return [0.5 + x * m / (1.5 * w), 0.5 + y * m / (1.5 * h)];
  }

  // Mirrors the segment path inside snakeSDF2D, on the same accumulated
  // foreground clock. Keep this in step with the GLSL or the trails detach
  // from the bodies.
  _snakeSegPos(seed, i) {
    const time = this.ftime * 0.8;
    const hx = Math.sin(time + seed) * 0.6 + Math.sin(time * 0.62 + seed * 3.0) * 0.25;
    const hy = Math.cos(time * 0.7 + seed) * 0.5 + Math.cos(time * 0.53 + seed * 5.0) * 0.2;
    const phase = time - i * PROTO_SEG_LAG + seed * 7.0;
    const side = Math.sin(phase * 1.15) * 0.35 * (1.0 - i * 0.06);
    const forward = Math.cos(phase * 0.85) * 0.25 * (1.0 - i * 0.04);
    return [hx + forward - i * PROTO_SEG_LEN, hy + side];
  }

  // Fill the staging arrays; returns how many colonies to inject this frame.
  // Deposition runs on wall-clock seconds, so Speed changes the pace of the
  // scene without changing how much pigment ends up in the field.
  _updateCells(dt) {
    const t = this.time;
    const gain = this.params.deposit.value * dt;
    const pos = this.posArr, col = this.colArr, rad = this.radArr;
    let n = 0;

    for (let i = 0; i < this.drifters.length && n < PROTO_MAX_CELLS; i++) {
      const c = this.drifters[i];
      const x = 0.5 + (Math.sin(t * c.sx + c.seed) * 0.42 + Math.sin(t * c.sx2 + c.seed * 3.1) * 0.11) * c.amp;
      const y = 0.5 + (Math.cos(t * c.sy + c.seed * 1.7) * 0.38 + Math.cos(t * c.sy2 + c.seed * 2.3) * 0.10) * c.amp;
      const pulse = 0.65 + 0.35 * Math.sin(t * c.pr + c.seed * 5.0);

      pos[n * 2] = x;
      pos[n * 2 + 1] = y;
      rad[n] = c.rad * pulse;
      col[n * 3] = c.col[0] * gain * pulse;
      col[n * 3 + 1] = c.col[1] * gain * pulse;
      col[n * 3 + 2] = c.col[2] * gain * pulse;
      n++;
    }

    for (let s = 0; s < SNAKE_SEEDS.length && n < PROTO_MAX_CELLS; s++) {
      for (let k = 0; k < TRAIL_SEGS.length && n < PROTO_MAX_CELLS; k++) {
        const seg = TRAIL_SEGS[k];
        const p = this._snakeSegPos(SNAKE_SEEDS[s], seg);
        const uvp = this._sceneToUV(p[0], p[1]);
        const fade = 1.0 - seg / 14.0;
        const c = PALETTE[(s * 3 + k) % PALETTE.length];

        pos[n * 2] = uvp[0];
        pos[n * 2 + 1] = uvp[1];
        rad[n] = (0.05 - seg * 0.0025) * (0.9 + 0.1 * Math.sin(t * 0.7 + seg));
        col[n * 3] = c[0] * gain * 2.1 * fade;
        col[n * 3 + 1] = c[1] * gain * 2.1 * fade;
        col[n * 3 + 2] = c[2] * gain * 2.1 * fade;
        n++;
      }
    }

    return n;
  }

  process(graph, glCanvas) {
    const now = performance.now() / 1000;
    const dt = Math.min(Math.max(now - this.lastTime, 0), MAX_DT);
    this.lastTime = now;

    const scaled = dt * this.params.speed.value;
    this.time += scaled;
    this.ftime += scaled * this.params.motion.value;

    const count = this._updateCells(dt);

    // 1. Inject the colonies onto the persistent field: state[0] -> state[1]
    this._pass(this.injectShader, this.state[1], sh => {
      sh.setUniform('u_texture', this.state[0]);
      sh.setUniform('u_resolution', this.simRes);
      sh.setUniform('u_positions', this.posArr);
      sh.setUniform('u_rgbColors', this.colArr);
      sh.setUniform('u_radii', this.radArr);
      sh.setUniform('u_numColors', count);
    });

    // 2. Diffuse: state[1] -> state[0]
    this._pass(this.diffuseShader, this.state[0], sh => {
      sh.setUniform('u_texture', this.state[1]);
      sh.setUniform('u_resolution', this.simRes);
      sh.setUniform('u_diffusionRate', this.params.diffusion.value);
      sh.setUniform('u_pigmentGamma', PIGMENT_GAMMA);
    });

    // 3. Bleed along paper fibre: state[0] -> state[1]
    this._pass(this.bleedShader, this.state[1], sh => {
      sh.setUniform('u_texture', this.state[0]);
      sh.setUniform('u_resolution', this.simRes);
      sh.setUniform('u_bleedStrength', this.params.bleed.value);
      sh.setUniform('u_paperFreq', PAPER_FREQ);
      sh.setUniform('u_dry', this.params.dry.value);
    });

    // 4. Ripple feedback + decay: state[1] -> state[0]. Four passes, so the
    //    live field lands back where it started and nothing has to be swapped.
    this._pass(this.feedbackShader, this.state[0], sh => {
      sh.setUniform('u_texture', this.state[1]);
      sh.setUniform('u_resolution', this.simRes);
      sh.setUniform('u_time', this.time);
      sh.setUniform('u_feedback', this.params.feedback.value);
      sh.setUniform('u_wash', WASH);
    });

    // 5. Banding, outside the persistent chain. state[1] is stale now, so it
    //    doubles as the scratch target.
    this._pass(this.bandingShader, this.state[1], sh => {
      sh.setUniform('u_texture', this.state[0]);
      sh.setUniform('u_resolution', this.simRes);
      sh.setUniform('u_time', this.time);
      sh.setUniform('u_bandingStrength', this.params.banding.value);
    });

    // 6. Display grade with a soft temporal trail
    const prev = this.dispCur;
    this.dispCur = 1 - this.dispCur;
    this._pass(this.displayShader, this.disp[this.dispCur], sh => {
      sh.setUniform('u_texture', this.state[1]);
      sh.setUniform('u_previousTexture', this.disp[prev]);
      sh.setUniform('u_resolution', this.simRes);
      sh.setUniform('u_time', this.time);
    });

    // 7. Reduce the display target's alpha to a single frame-wide mean, which
    //    is what the scene's auto-exposure runs on.
    this._pass(this.meanShader, this.meanA, sh => {
      sh.setUniform('u_texture', this.disp[this.dispCur]);
      sh.setUniform('u_cells', MEAN_CELLS);
    });
    this._pass(this.meanShader, this.meanB, sh => {
      sh.setUniform('u_texture', this.meanA);
      sh.setUniform('u_cells', 1);
    });

    // 8. Scene, with the watercolour field blended into the swamp
    this._pass(this.sceneShader, this.outputFBO, sh => {
      sh.setUniform('u_protozoa', this.disp[this.dispCur]);
      sh.setUniform('u_mean', this.meanB);
      sh.setUniform('u_time', this.time);
      sh.setUniform('u_ftime', this.ftime);
      // protoGrad derives a texel step from this, so it wants the physical size
      sh.setUniform('u_resolution', this.fragResolution());
      sh.setUniform('u_gain', this.params.gain.value);
    });
  }

  dispose() {
    this.state = [null, null];
    this.disp = [null, null];
    this.meanA = null;
    this.meanB = null;
    this.injectShader = null;
    this.diffuseShader = null;
    this.bleedShader = null;
    this.feedbackShader = null;
    this.bandingShader = null;
    this.displayShader = null;
    this.meanShader = null;
    this.sceneShader = null;
    super.dispose();
  }
}

registerModule('Protozoa', ProtozoaModule);
