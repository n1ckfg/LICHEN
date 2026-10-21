import { Module } from './Module.js';
import { vertSrc } from '../shaders/vert.js';
import { videoToastingEffects } from '../shaders/videotoasting/index.js';
import { registerModule } from '../moduleRegistry.js';

const MAX_DT = 0.1;   // clamp long stalls so a tab switch doesn't jump the effect

// The Inputs knob shows the first n. Inputs share one row across the node, and
// past six their ports' hit areas overlap. A and B kept their ids when the
// count became a knob, so older patches load unchanged.
const INPUT_PORTS = [
  { id: '5249', name: 'A', type: 'video' },
  { id: 'e8f4', name: 'B', type: 'video' },
  { id: 'f59c', name: 'C', type: 'video' },
  { id: '19de', name: 'D', type: 'video' },
  { id: '4699', name: 'E', type: 'video' },
  { id: '67da', name: 'F', type: 'video' },
];

const wrap = (i, n) => ((i % n) + n) % n;

// The inputs for the effect's A and B buses at time t, picked from the
// connected inputs in port order (see videoToastingEffects). A lone input
// feeds both, as in VideoMixer.
function busInputs(effect, sources, t) {
  const n = sources.length;
  const k = Math.floor((t - effect.offset) / effect.segment);
  if (effect.reveal) {
    return [sources[0], sources[n > 1 ? 1 + wrap(k, n - 1) : 0]];
  }
  const from = sources[wrap(k, n)];
  const to = sources[wrap(k + 1, n)];
  return effect.outgoing[wrap(k, effect.outgoing.length)] === 'A' ? [from, to] : [to, from];
}

// NewTek Video Toaster transitions, ported from the VideoToasting project. Each
// effect loops a wipe between A (the Toaster's outgoing Main bus) and B (the
// incoming Preview bus), and is its own shader in js/shaders/videotoasting/.
// With more inputs it steps through them, two at a time.
export class VideoToastingModule extends Module {
  static uid = '8bf4012e';

  constructor(glCanvas, id) {
    super('VideoToasting', glCanvas, id);
    this.inputs = INPUT_PORTS.slice(0, 2);
    this.outputs = [{ id: '52d7', name: 'out', type: 'video' }];
    this.params = {
      effect: {
        id: '3f8f', value: 0, min: 0, max: videoToastingEffects.length - 1, step: 1, label: 'Effect', widget: 'dropdown',
        valueLabels: videoToastingEffects.map(e => e.label),
      },
      speed: { id: '899a', value: 1.0, min: 0, max: 4, step: 0.01, label: 'Speed' },
      inputCount: { id: '04af', value: 2, min: 2, max: INPUT_PORTS.length, step: 1, label: 'Inputs' },
    };
    // p5 compiles a shader the first time it is bound, so unchosen effects cost nothing
    this.effectShaders = videoToastingEffects.map(e => glCanvas.createShader(vertSrc, e.frag));
    this.createOutputFBO();

    // Accumulated rather than read off a clock, so turning Speed doesn't jump the
    // effect. At speed 1 it runs in seconds, as the originals' frameCount * 0.016 did at 60 fps.
    this.time = 0;
    this.lastTime = performance.now() / 1000;
    // One past the last port with a cable in it, counted each frame
    this.portsInUse = 0;
  }

  // The Inputs knob adds and removes ports, but never one with a cable in it.
  // There are only so many ports, so a typed count is clamped too.
  setParam(name, value, clamp = true) {
    super.setParam(name, value, clamp || name === 'inputCount');
    if (name !== 'inputCount') return;
    const count = Math.max(Math.round(this.params.inputCount.value), this.portsInUse);
    this.params.inputCount.value = count;
    if (count !== this.inputs.length) this.inputs = INPUT_PORTS.slice(0, count);
  }

  process(graph, glCanvas) {
    const now = performance.now() / 1000;
    const dt = Math.min(now - this.lastTime, MAX_DT);
    this.lastTime = now;
    this.time += dt * this.params.speed.value;

    this.portsInUse = Math.max(0, ...graph.getInputConnections(this.id).map(c => c.toPort + 1));
    const sources = this.inputs.map((_, i) => this.getInput(graph, i)).filter(Boolean);
    if (sources.length === 0) return;
    const index = Math.round(this.params.effect.value);
    // uTime reaches the shader as a 32-bit float. Picking the inputs from the
    // same value keeps a bus from changing a frame before the shader wraps.
    const [texA, texB] = busInputs(videoToastingEffects[index], sources, Math.fround(this.time));
    const shader = this.effectShaders[index];
    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(shader);
    shader.setUniform('texA', texA);
    shader.setUniform('texB', texB);
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
