import { Module } from './Module.js';
import { vertSrc } from '../shaders/vert.js';
import { videoToastingEffects } from '../shaders/videotoasting/index.js';
import { registerModule } from '../moduleRegistry.js';

const MAX_DT = 0.1;   // clamp long stalls so a tab switch doesn't jump the effect

// NewTek Video Toaster transitions, ported from the VideoToasting project. Each
// effect loops a wipe between A (the Toaster's outgoing Main bus) and B (the
// incoming Preview bus), and is its own shader in js/shaders/videotoasting/.
export class VideoToastingModule extends Module {
  constructor(glCanvas, id) {
    super('VideoToasting', glCanvas, id);
    this.inputs = [
      { name: 'A', type: 'video' },
      { name: 'B', type: 'video' },
    ];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      effect: {
        value: 0, min: 0, max: videoToastingEffects.length - 1, step: 1, label: 'Effect', widget: 'dropdown',
        valueLabels: videoToastingEffects.map(e => e.label),
      },
      speed: { value: 1.0, min: 0, max: 4, step: 0.01, label: 'Speed' },
    };
    // p5 compiles a shader the first time it is bound, so unchosen effects cost nothing
    this.effectShaders = videoToastingEffects.map(e => glCanvas.createShader(vertSrc, e.frag));
    this.createOutputFBO();

    // Accumulated rather than read off a clock, so turning Speed doesn't jump the
    // effect. At speed 1 it runs in seconds, as the originals' frameCount * 0.016 did at 60 fps.
    this.time = 0;
    this.lastTime = performance.now() / 1000;
  }

  process(graph, glCanvas) {
    const now = performance.now() / 1000;
    const dt = Math.min(now - this.lastTime, MAX_DT);
    this.lastTime = now;
    this.time += dt * this.params.speed.value;

    const inputA = this.getInput(graph, 0);
    const inputB = this.getInput(graph, 1);
    if (!inputA && !inputB) return;
    const shader = this.effectShaders[Math.round(this.params.effect.value)];
    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(shader);
    shader.setUniform('texA', inputA || inputB);
    shader.setUniform('texB', inputB || inputA);
    shader.setUniform('uTime', this.time);
    this.renderQuad();
    this.outputFBO.end();
  }

  dispose() {
    this.effectShaders = [];
    super.dispose();
  }
}

registerModule('VideoToasting', VideoToastingModule);
