import { LatkModule } from './LatkModule.js';
import { registerModule } from '../moduleRegistry.js';
import '../libraries/p5.twoscilloscope.js';   // a classic script: it puts its classes on window
import { LatkScopeRenderer } from './twoscilloscope/LatkScopeRenderer.js';
import { latkSegmentVert } from '../shaders/latk.js';
import { twoscilloscopeBeamFrag } from '../shaders/twoscilloscope.js';

const { Twoscilloscope, XYscope, XYDecoder, WavFile } = window;

const SAMPLE_RATE = 44100;
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

// Twoscilloscope's example-latk: a 3D Latk animation, seen through an orbiting
// camera, is encoded frame by frame as one loop of XY audio, run through an
// audio effect chain, and drawn back from the altered audio, as the
// oscilloscope beam or decoded into strokes, each in its stroke's colour.
// Sound plays the altered loop out of the sound card. Loading, playback, the
// camera and the lines come from LatkModule.
export class TwoscilloscopeModule extends LatkModule {
  constructor(glCanvas, id) {
    super(glCanvas, id, 'Twoscilloscope');
    this.historicalInfo = 'Twoscilloscope';

    this.scope = new LatkScopeRenderer(SAMPLE_RATE);
    const effects = this.scope.transformer.effects;
    this.chain = CHAIN.map((spec) => effects.add(new window[spec.type]()));
    // Every setting's library default, which it goes back to whenever the
    // knobs aren't turning it, so the knobs alone decide the chain
    this.chainDefaults = this.chain.map((effect) => Object.fromEntries(
      effect.parameters.items.filter((it) => it.key !== 'enabled').map((it) => [it.key, effect[it.key]])));

    // Latk's knobs, without Width: the lines here are the example's
    const { fps, yaw, pitch, distance, spin } = this.params;
    const cutoff = settingRange(this.chain[0], 'cutoff');
    const delayY = settingRange(this.chain[1], 'delayY');
    this.params = {
      view: {
        value: BEAMS, min: 0, max: 2, step: 1, label: 'View',
        widget: 'dropdown', valueLabels: ['Beams', 'Decoded Strokes', 'Original Lines'],
      },
      fps, yaw, pitch, distance, spin,
      loopHz: { value: 5, min: 1, max: 100, step: 0.1, label: 'Loop Hz' },
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
    };
    this._applyEffects();

    this.beamShader = glCanvas.createShader(latkSegmentVert, twoscilloscopeBeamFrag);

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
    super.process(graph, glCanvas);
  }

  drawFrame(glCanvas) {
    // The whole round trip, every frame: strokes -> audio -> effects -> strokes
    const scope = this.scope;
    scope.loopFreq = this.params.loopHz.value;
    scope.beamSize = this.params.beamSize.value;
    scope.update(this.latk, this.cam, glCanvas.width, glCanvas.height);
    if (this.soundOn) this._feedPlayer();

    const view = Math.round(this.params.view.value);
    if (view === BEAMS) {
      scope.beamStream();
      // The beams add up, as OsciMesh's did
      const size = this.params.beamSize.value * 2 / glCanvas.height;
      const intensity = this.params.intensity.value * scope.beamExposure;
      this.drawSegments(glCanvas, this.beamShader, scope.stream, glCanvas.ADD, (s) => {
        s.setUniform('uSize', size);
        s.setUniform('uIntensity', intensity);
      });
    } else {
      if (view === STROKES) scope.strokeStream();
      else scope.lineStream();
      this.drawLines(glCanvas, scope.stream, LINE_WIDTH);
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
    super.dispose();
  }
}

registerModule('Twoscilloscope', TwoscilloscopeModule);
