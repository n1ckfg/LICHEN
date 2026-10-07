import { Module } from './Module.js';
import { registerModule } from '../moduleRegistry.js';
import '../libraries/p5.twoscilloscope.js';   // a classic script: it puts its classes on window
import { ScopeRenderer } from './twoscilloscope/ScopeRenderer.js';
import { SegmentRenderer } from './latk/SegmentRenderer.js';
import { latkSegmentVert } from '../shaders/latk.js';
import { twoscilloscopeBeamFrag } from '../shaders/twoscilloscope.js';

const { Twoscilloscope, XYscope, XYDecoder, WavFile } = window;

const LINE_WIDTH = 2;        // the example's strokeWeight, in output pixels

const BEAMS = 0, STROKES = 1;

// The example's effect chain, in its order. Each entry names the settings the
// Effect A and Effect B knobs turn while it is on. The knobs run 0..1 across a
// setting's own range, from the library's panel, logarithmically (log: true)
// where that range spans decades.
const CHAIN = [
  { type: 'XYLowPass', label: 'Low Pass', a: { key: 'cutoff', label: 'Cutoff', log: true }, b: { key: 'resonance', label: 'Resonance', log: true } },
  { type: 'XYChannelDelay', label: 'Channel Delay', a: { key: 'delayX', label: 'Delay X' }, b: { key: 'delayY', label: 'Delay Y' } },
  { type: 'XYHighPass', label: 'High Pass', a: { key: 'cutoff', label: 'Cutoff', log: true }, b: { key: 'resonance', label: 'Resonance', log: true } },
  { type: 'XYEcho', label: 'Echo', a: { key: 'time', label: 'Time', log: true }, b: { key: 'feedback', label: 'Feedback' } },
  { type: 'XYRingMod', label: 'Ring Mod', a: { key: 'freq', label: 'Freq', log: true }, b: { key: 'depth', label: 'Depth' } },
  { type: 'XYRotate', label: 'Rotate', a: { key: 'angle', label: 'Angle' }, b: { key: 'spin', label: 'Spin Rate' } },
  { type: 'XYDrive', label: 'Drive', a: { key: 'gain', label: 'Gain', log: true } },
  { type: 'XYWavefold', label: 'Wavefold', a: { key: 'gain', label: 'Gain', log: true } },
  { type: 'XYBitCrush', label: 'Bit Crush', a: { key: 'bits', label: 'Bits' } },
  { type: 'XYSampleHold', label: 'Sample & Hold', a: { key: 'rate', label: 'Rate', log: true } },
  { type: 'XYNoise', label: 'Noise', a: { key: 'amount', label: 'Amount' }, b: { key: 'seed', label: 'Noise Seed' } },
];

// The Effect drop-down. Option 0 is the chain the example opens with: Low Pass
// at 1500 Hz into Channel Delay with Y 0.6 ms late. Option 1 is its n key, and
// the rest are its e key, soloing one effect at a time. Patches save the option
// as its index, so a new one is appended, never inserted.
const OPENING = 0, NO_EFFECTS = 1, FIRST_SOLO = 2;
const EFFECT_OPTIONS = [
  { label: 'Low Pass + Delay', on: [0, 1], a: [0, 'a'], b: [1, 'b'] },
  { label: 'None', on: [] },
  ...CHAIN.map((spec, i) => ({ label: spec.label, on: [i], a: [i, 'a'], b: spec.b ? [i, 'b'] : null })),
];

// The library's panel range of one setting
function settingRange(effect, key) {
  const item = effect.parameters.items.find((it) => it.key === key);
  return { min: item.min, max: item.max, int: item.type === 'int' };
}

// Knob (0..1) -> setting, and back
function knobToSetting(t, { min, max, int }, log) {
  const v = log ? min * Math.pow(max / min, t) : min + t * (max - min);
  return int ? Math.round(v) : v;
}

function settingToKnob(v, { min, max }, log) {
  return log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min);
}

// Twoscilloscope's example-latk without the drawing: one loop of XY audio,
// brought in on the X and Y control pins, runs through an audio effect chain
// and is drawn back from the altered audio, as the oscilloscope beam or
// decoded into strokes. Sound plays the altered loop out of the sound card.
//
// The Latk module's X and Y outputs bring its drawing as the example encoded
// it, blanking and stroke colours included. Any other control output works
// too: one that brings only a 0..1 value each frame is drawn as a trail of
// its last Trail seconds.
export class TwoscilloscopeModule extends Module {
  constructor(glCanvas, id) {
    super('Twoscilloscope', glCanvas, id);
    this.inputs = [{ name: 'x', type: 'control' }, { name: 'y', type: 'control' }];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.historicalInfo = 'Twoscilloscope';

    this.scope = new ScopeRenderer();
    const effects = this.scope.transformer.effects;
    this.chain = CHAIN.map((spec) => effects.add(new window[spec.type]()));
    // Every setting's library default, which it goes back to whenever the
    // knobs aren't turning it, so the knobs alone decide the chain
    this.chainDefaults = this.chain.map((effect) => Object.fromEntries(
      effect.parameters.items.filter((it) => it.key !== 'enabled').map((it) => [it.key, effect[it.key]])));

    const cutoff = settingRange(this.chain[0], 'cutoff');
    const delayY = settingRange(this.chain[1], 'delayY');
    this.params = {
      view: {
        value: BEAMS, min: 0, max: 2, step: 1, label: 'View',
        widget: 'dropdown', valueLabels: ['Beams', 'Decoded Strokes', 'Original Lines'],
      },
      beamSize: { value: 3, min: 0.5, max: 12, step: 0.1, label: 'Beam Size' },
      intensity: { value: 1, min: 0, max: 4, step: 0.01, label: 'Intensity' },
      effect: {
        value: OPENING, min: 0, max: EFFECT_OPTIONS.length - 1, step: 1, label: 'Effect',
        widget: 'dropdown', valueLabels: EFFECT_OPTIONS.map((o) => o.label),
      },
      fxA: { value: settingToKnob(1500, cutoff, true), min: 0, max: 1, step: 0.001, label: 'Effect A' },
      fxB: { value: settingToKnob(0.6, delayY, false), min: 0, max: 1, step: 0.001, label: 'Effect B' },
      sound: {
        value: 0, min: 0, max: 1, step: 1, label: 'Sound',
        widget: 'dropdown', valueLabels: ['Off', 'On'],
      },
      // Seconds of a frame-rate control input drawn at once
      trail: { value: 1, min: 0.1, max: 10, step: 0.1, label: 'Trail' },
    };
    this._applyEffects();

    this.segments = new SegmentRenderer(glCanvas, 'Twoscilloscope');
    this.beamShader = glCanvas.createShader(latkSegmentVert, twoscilloscopeBeamFrag);
    this.createOutputFBO();
    this.history = [];        // { t, x, y } a frame, while only 0..1 values come in

    // Loops the altered audio out of the sound card while Sound is on. XYscope's
    // own defaults are the example's setup(): 44.1 kHz in blocks of 512.
    this.player = new XYscope();
    this.soundOn = false;
  }

  // Which effects are on, and what Effect A and B set on them
  _applyEffects() {
    const option = EFFECT_OPTIONS[Math.round(this.params.effect.value)] || EFFECT_OPTIONS[OPENING];
    this.chain.forEach((effect, i) => {
      Object.assign(effect, this.chainDefaults[i]);
      effect.enabled = option.on.includes(i);
    });
    for (const knob of ['a', 'b']) {
      const param = this.params[knob === 'a' ? 'fxA' : 'fxB'];
      const target = option[knob];
      if (!target) {
        param.label = knob === 'a' ? 'Effect A' : 'Effect B';
        continue;
      }
      const [index, which] = target;
      const setting = CHAIN[index][which];
      const effect = this.chain[index];
      param.label = setting.label;
      effect[setting.key] = knobToSetting(param.value, settingRange(effect, setting.key), setting.log);
    }
  }

  _setSound(on) {
    if (on === this.soundOn) return;
    this.soundOn = on;
    if (on) this.player.openAudioOut();
    else this.player.closeAudioOut();
  }

  // The altered loop, for the sound card or a WAV, Z (blanking) included
  _feedPlayer() {
    this.player.freq(this.scope.getFreq());
    this.player.setWaveforms(this.scope.x, this.scope.y, this.scope.z);
  }

  process(graph, glCanvas) {
    this._setSound(Math.round(this.params.sound.value) === 1);
    this._applyEffects();
    const input = this._readInputs(graph);

    this.outputFBO.begin();
    glCanvas.background(0);
    if (input) {
      // The whole round trip, every frame: audio -> effects -> strokes
      this.scope.beamSize = this.params.beamSize.value;
      this.scope.update(input, glCanvas.width, glCanvas.height);
      this._draw(glCanvas, Math.round(this.params.view.value));
    } else {
      this.scope.clear();
    }
    this.outputFBO.end();
    if (this.soundOn) this._feedPlayer();
  }

  // X and Y as one loop for the scope: { x, y, z, color, sampleRate }, or null
  // with nothing cabled in. A loop on either pin sets the length, and brings
  // its blanking and colours (X's, if both bring a loop). An unplugged pin
  // stays at 0, the centre.
  _readInputs(graph) {
    const xIn = this.getControlInput(graph, 0);
    const yIn = this.getControlInput(graph, 1);
    const looped = [xIn, yIn].find((c) => c && c.signal && c.signal.samples.length >= 2);
    if (looped) {
      this.history = [];
      const { samples, sampleRate, z, color } = looped.signal;
      const n = samples.length;
      return { x: lane(xIn, n), y: lane(yIn, n), z: z ?? null, color: color ?? null, sampleRate };
    }
    if (!xIn && !yIn) {
      this.history = [];
      return null;
    }

    // Only 0..1 values each frame: draw the last Trail seconds of them, as a
    // scope with a long persistence would
    const now = performance.now() / 1000;
    const trail = this.params.trail.value;
    this.history.push({ t: now, x: xIn ? xIn.value * 2 - 1 : 0, y: yIn ? yIn.value * 2 - 1 : 0 });
    while (now - this.history[0].t > trail) this.history.shift();
    const n = this.history.length;
    return {
      x: Float32Array.from(this.history, (h) => h.x),
      y: Float32Array.from(this.history, (h) => h.y),
      z: null, color: null, sampleRate: n / trail,
    };
  }

  _draw(glCanvas, view) {
    const scope = this.scope;
    if (view === BEAMS) {
      scope.beamStream();
      // The beams add up, as OsciMesh's did
      const size = this.params.beamSize.value * 2 / glCanvas.height;
      const intensity = this.params.intensity.value * scope.beamExposure;
      this.segments.drawSegments(this.beamShader, scope.stream, glCanvas.ADD, (s) => {
        s.setUniform('uSize', size);
        s.setUniform('uIntensity', intensity);
      });
    } else {
      if (view === STROKES) scope.strokeStream();
      else scope.lineStream();
      this.segments.drawLines(scope.stream, LINE_WIDTH, this.pixelDensity);
    }
  }

  // The example's keys: l view, e solo next effect, n no effects, m sound,
  // s save svg, w save wav
  handleKey(key) {
    const k = key.toLowerCase();
    if (k === 'l') {
      this.setParam('view', (Math.round(this.params.view.value) + 1) % 3);
    } else if (k === 'e') {
      const option = Math.round(this.params.effect.value);
      this.setParam('effect', option < FIRST_SOLO || option === EFFECT_OPTIONS.length - 1 ? FIRST_SOLO : option + 1);
    } else if (k === 'n') {
      this.setParam('effect', NO_EFFECTS);
    } else if (k === 'm') {
      this.setParam('sound', Math.round(this.params.sound.value) === 1 ? 0 : 1);
    } else if (k === 's') {
      const path = 'transformed_' + Twoscilloscope.timestamp('%Y%m%d_%H%M%S') + '.svg';
      XYDecoder.saveSvg(path, this.scope.getStrokes(), this.glCanvas.width, this.glCanvas.height);
    } else if (k === 'w') {
      // four seconds of the altered loop, X Y Z
      this._feedPlayer();
      const path = 'transformed_' + Twoscilloscope.timestamp('%Y%m%d_%H%M%S') + '.wav';
      WavFile.save(path, this.player.render(4, 3));
    }
  }

  dispose() {
    this.player.closeAudioOut();
    this.segments.dispose();
    super.dispose();
  }
}

// One pin's samples over a loop of n: its own loop, stretched to n if it is
// another length, its 0..1 value held across the loop, or 0 when unplugged
function lane(input, n) {
  if (!input) return new Float32Array(n);
  const s = input.signal?.samples;
  if (!s || s.length < 2) return new Float32Array(n).fill(input.value * 2 - 1);
  if (s.length === n) return s;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const at = i * (s.length - 1) / (n - 1);
    const i0 = Math.min(Math.floor(at), s.length - 2);
    out[i] = s[i0] + (s[i0 + 1] - s[i0]) * (at - i0);
  }
  return out;
}

registerModule('Twoscilloscope', TwoscilloscopeModule);
