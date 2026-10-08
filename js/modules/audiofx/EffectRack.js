// The audio effects Twoscilloscope and SlowscanJam share: the eleven effects of
// example-latk's chain from p5.twoscilloscope, an Effect drop-down that turns
// them on, and two knobs, Effect A and Effect B, that set them.
//
// A module's menu and knobs resolve to plain data ({ on, set }), which an
// EffectRack applies to its effects. Twoscilloscope runs its rack on the main
// thread, inside its XYTransformer, which restarts the effects on every loop
// (see twoscilloscope/ScopeRenderer.js). SlowscanJam sends the data to its
// worker, where an EffectStream keeps the effects running from field to field.
// Nothing here touches the DOM or p5, so a worker can import it.
import '../../libraries/p5.twoscilloscope.js';   // a classic script: it puts its classes on the global scope

const lib = globalThis;

// The example's effect chain, in its order. Each entry names the settings the
// Effect A and Effect B knobs turn while it is on. The knobs run 0..1 across a
// setting's own range, from the library's panel, logarithmically (log: true)
// where that range spans decades.
export const CHAIN = [
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

// Each effect's settings: their panel ranges, and the library defaults they go
// back to whenever the knobs aren't turning them, so the knobs alone decide
// the chain
const SETTINGS = CHAIN.map((spec) => {
  const effect = new lib[spec.type]();
  const items = effect.parameters.items.filter((it) => it.key !== 'enabled');
  return {
    ranges: Object.fromEntries(items.map((it) => [it.key, { min: it.min, max: it.max, int: it.type === 'int' }])),
    defaults: Object.fromEntries(items.map((it) => [it.key, effect[it.key]])),
  };
});

// Knob (0..1) -> setting, and back
function knobToSetting(t, { min, max, int }, log) {
  const v = log ? min * Math.pow(max / min, t) : min + t * (max - min);
  return int ? Math.round(v) : v;
}

function settingToKnob(v, { min, max }, log) {
  return log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min);
}

// The knob position that sets CHAIN[index]'s Effect A or B setting (which is
// 'a' or 'b') to value
export function knobFor(index, which, value) {
  const setting = CHAIN[index][which];
  return settingToKnob(value, SETTINGS[index].ranges[setting.key], setting.log);
}

// A menu option: the chain indices it turns on, and the [index, 'a' | 'b']
// settings the Effect A and B knobs turn while it is chosen
export const NONE = { label: 'None', on: [] };
const SOLOS = CHAIN.map((spec, i) => ({ label: spec.label, on: [i], a: [i, 'a'], b: spec.b ? [i, 'b'] : null }));

// A module's Effect drop-down: its own options first (head), then one option
// per effect, soloing it in the chain's order. Patches save the option as its
// index, so a module's head never changes, and a new effect is appended.
export class EffectMenu {
  constructor(head) {
    this.options = [...head, ...SOLOS];
    this.firstSolo = head.length;
    this.none = this.options.indexOf(NONE);
  }

  // The drop-down and the two knobs, as module params. Their ids are the same
  // in every module that spreads these in, so its own params must avoid them.
  params(option, fxA, fxB) {
    return {
      effect: {
        id: '7c56', value: option, min: 0, max: this.options.length - 1, step: 1, label: 'Effect',
        widget: 'dropdown', valueLabels: this.options.map((o) => o.label),
      },
      fxA: { id: '7df9', value: fxA, min: 0, max: 1, step: 0.001, label: 'Effect A' },
      fxB: { id: '3c06', value: fxB, min: 0, max: 1, step: 0.001, label: 'Effect B' },
    };
  }

  // What the option and knobs in params ask of an EffectRack, as plain data a
  // worker can be sent: { on: [index, ...], set: [[index, key, value], ...] }.
  // The knobs' labels follow the option.
  resolve(params) {
    const option = this.options[Math.round(params.effect.value)] || this.options[0];
    const set = [];
    for (const knob of ['a', 'b']) {
      const param = params[knob === 'a' ? 'fxA' : 'fxB'];
      const target = option[knob];
      if (!target) {
        param.label = knob === 'a' ? 'Effect A' : 'Effect B';
        continue;
      }
      const [index, which] = target;
      const setting = CHAIN[index][which];
      param.label = setting.label;
      set.push([index, setting.key, knobToSetting(param.value, SETTINGS[index].ranges[setting.key], setting.log)]);
    }
    return { on: option.on, set };
  }

  // example-latk's e key: solo the next effect, or the first from a head option
  nextSolo(option) {
    return option < this.firstSolo || option === this.options.length - 1 ? this.firstSolo : option + 1;
  }
}

// One of each effect, in CHAIN's order, added to an XYEffectChain: a new one,
// or one that is already running, such as an XYTransformer's
export class EffectRack {
  constructor(chain = new lib.XYEffectChain()) {
    this.chain = chain;
    this.effects = CHAIN.map((spec) => chain.add(new lib[spec.type]()));
    this.on = [];
  }

  // Settings from EffectMenu.resolve()
  apply({ on, set }) {
    this.effects.forEach((effect, i) => {
      Object.assign(effect, SETTINGS[i].defaults);
      effect.enabled = on.includes(i);
    });
    for (const [index, key, value] of set) this.effects[index][key] = value;
    this.on = on;
  }

  get active() {
    return this.on.length > 0;
  }

  reset() {
    this.chain.reset();
  }
}

// Settings an effect only reads when it restarts: XYNoise's seed
const RESTART_KEYS = new Set(['seed']);

// The rack in stream mode, for a signal that runs on from one call to the
// next, as SlowscanJam's fields do. The effects keep their state between
// calls, where Twoscilloscope's loop restarts them every frame, so echoes carry
// over and noise and spin move on.
export class EffectStream {
  constructor() {
    this.rack = new EffectRack();
    this.buffer = new lib.XYSoundBuffer(0, 2);
    this.restartKey = '';
  }

  // Settings from EffectMenu.resolve(). The effects restart when the option
  // changes, so an effect turned back on doesn't replay what it held before.
  apply(settings) {
    const key = settings.on.join(' ') + '|' +
      settings.set.filter(([, k]) => RESTART_KEYS.has(k)).map(([, , v]) => v).join(' ');
    if (key !== this.restartKey) {
      this.rack.reset();
      this.restartKey = key;
    }
    this.rack.apply(settings);
  }

  get active() {
    return this.rack.active;
  }

  reset() {
    this.rack.reset();
  }

  // Runs x and y, of the same length, through the effects, in place.
  // protect: { mask, gain, limit: [x, y] } passes only the samples where mask
  // is 1 through the effects, scaled by gain going in and back coming out, and
  // then clamped to ±limit. The rest keep their values, and the effects get 0
  // in their place, so nothing of them leaks into the samples around them.
  process(x, y, sampleRate, protect = null) {
    const n = x.length;
    const buffer = this.buffer;
    if (buffer.samples.length !== n * 2) buffer.samples = new Float32Array(n * 2);
    buffer.sampleRate = sampleRate;
    const s = buffer.samples;
    const mask = protect?.mask;
    const gain = protect ? protect.gain : 1;
    for (let i = 0; i < n; i++) {
      const g = !mask || mask[i] ? gain : 0;
      s[i * 2] = x[i] * g;
      s[i * 2 + 1] = y[i] * g;
    }
    this.rack.chain.process(buffer);
    if (!protect) {
      for (let i = 0; i < n; i++) {
        x[i] = s[i * 2];
        y[i] = s[i * 2 + 1];
      }
      return;
    }
    const back = 1 / gain;
    const [lx, ly] = protect.limit;
    for (let i = 0; i < n; i++) {
      if (mask && !mask[i]) continue;
      x[i] = Math.max(-lx, Math.min(lx, s[i * 2] * back));
      y[i] = Math.max(-ly, Math.min(ly, s[i * 2 + 1] * back));
    }
  }
}
