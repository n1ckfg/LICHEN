import { Module } from './Module.js';
import { registerModule } from '../moduleRegistry.js';
import '../libraries/p5.twoscilloscope.js';   // a classic script: it puts its classes on window
import { LatkScopeRenderer } from './twoscilloscope/LatkScopeRenderer.js';
import { OrbitCamera } from './twoscilloscope/OrbitCamera.js';
import { readLatk } from './twoscilloscope/readLatk.js';
import {
  twoscilloscopeVert, twoscilloscopeBeamFrag, twoscilloscopeLineFrag, TWO_BATCH,
} from '../shaders/twoscilloscope.js';

const { Twoscilloscope, XYscope, XYDecoder, WavFile } = window;

const SAMPLE_RATE = 44100;
const MAX_DT = 0.1;          // clamp long stalls so a tab switch doesn't jump the clocks
const LINE_WIDTH = 2;        // the example's strokeWeight, in output pixels
const POINT_TEX_W = 2048;    // point stream texels per row
const ORBIT_RATE = 0.01;     // the example's drag rate, radians per pixel
const ZOOM_RATE = 0.001;     // and its wheel: distance x exp(delta x ZOOM_RATE)
const DEFAULT_FILE = new URL('../../files/latk/jellyfish.latk', import.meta.url);

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

let nextGeometryId = 0;

// Twoscilloscope's example-latk: a 3D Latk animation, seen through an orbiting
// camera, is encoded frame by frame as one loop of XY audio, run through an
// audio effect chain, and drawn back from the altered audio, as the
// oscilloscope beam or decoded into strokes, each in its stroke's colour.
// Sound plays the altered loop out of the sound card.
export class TwoscilloscopeModule extends Module {
  constructor(glCanvas, id) {
    super('Twoscilloscope', glCanvas, id);
    this.outputs = [{ name: 'out', type: 'video' }];
    this.historicalInfo = 'Twoscilloscope';

    this.scope = new LatkScopeRenderer(SAMPLE_RATE);
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
      fps: { value: 12, min: 0, max: 60, step: 1, label: 'FPS' },   // ofxLatk's 12 frames a second
      yaw: { value: 0, min: -180, max: 180, step: 1, label: 'Yaw' },
      pitch: { value: OrbitCamera.HOME_PITCH * 180 / Math.PI, min: -89, max: 89, step: 1, label: 'Pitch' },
      // In radii of the drawing, so it fits whatever its size
      distance: {
        value: OrbitCamera.HOME_DISTANCE, min: OrbitCamera.MIN_DISTANCE, max: OrbitCamera.MAX_DISTANCE, step: 0.01,
        label: 'Distance',
      },
      spin: { value: 0, min: -90, max: 90, step: 1, label: 'Spin' },
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

    this.beamShader = glCanvas.createShader(twoscilloscopeVert, twoscilloscopeBeamFrag);
    this.lineShader = glCanvas.createShader(twoscilloscopeVert, twoscilloscopeLineFrag);
    this.geometry = this._buildGeometry();
    this.createOutputFBO();
    // The point stream, one point per texel. Float, since it holds positions and
    // 24-bit colours, and sized up on demand.
    this.pointFBO = glCanvas.createFramebuffer({
      width: POINT_TEX_W, height: 8, density: 1, depth: false,
      format: glCanvas.FLOAT, textureFiltering: glCanvas.NEAREST,
    });
    this.warnedNoFloat = false;

    this.cam = new OrbitCamera();
    this.latk = null;         // { layers } once a drawing is in
    this.fileName = '';       // shown on the load button
    this.frameClock = 0;      // Latk frames still to advance
    this.spinYaw = 0;         // degrees turned by Spin, added to the Yaw knob
    this.dragX = null;        // last fullscreen drag position, null when not dragging
    this.dragY = null;
    this.lastTime = performance.now() / 1000;

    // Loops the altered audio out of the sound card while Sound is on. XYscope's
    // own defaults are the example's setup(): 44.1 kHz in blocks of 512.
    this.player = new XYscope();
    this.soundOn = false;

    this._createFileInput();
    this._loadDefault();
  }

  // One quad per segment in a batch. The vertex shader places every quad, so
  // this is built once and never re-uploaded.
  _buildGeometry() {
    const geometry = new p5.Geometry(1, 1, function () {
      for (let q = 0; q < TWO_BATCH; q++) {
        const base = this.vertices.length;
        this.vertices.push(
          new p5.Vector(-1, -1, q), new p5.Vector(1, -1, q),
          new p5.Vector(1, 1, q), new p5.Vector(-1, 1, q));
        this.faces.push([base, base + 1, base + 2], [base, base + 2, base + 3]);
      }
    });
    // p5 caches a geometry's GPU buffers under its gid (see Development Conventions)
    geometry.gid = `Twoscilloscope|${nextGeometryId++}`;
    return geometry;
  }

  _createFileInput() {
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.latk,.json';
    this.fileInput.style.display = 'none';
    document.body.appendChild(this.fileInput);
    this.fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) this.loadFile(file);
    });
  }

  pickFile() {
    this.fileInput.click();
  }

  async loadFile(file) {
    try {
      this._setDrawing(await readLatk(await file.arrayBuffer()), file.name);
    } catch (e) {
      // Keep whatever drawing was loaded before
      alert(`Could not load ${file.name}: ${e.message}`);
    }
    this.fileInput.value = '';   // so picking the same file again still fires 'change'
  }

  // The example's jellyfish, until a file is picked
  async _loadDefault() {
    try {
      const res = await fetch(DEFAULT_FILE);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const layers = await readLatk(await res.arrayBuffer());
      if (!this.latk) this._setDrawing(layers, 'jellyfish.latk');
    } catch (e) {
      console.error('Twoscilloscope: could not load jellyfish.latk', e);
    }
  }

  // The camera looks at the whole drawing, every frame of it, as the example's
  // frameDrawing() did
  _setDrawing(layers, fileName) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const layer of layers) {
      for (const frame of layer.frames) {
        for (const stroke of frame.strokes) {
          for (const p of stroke.points) {
            for (let i = 0; i < 3; i++) {
              min[i] = Math.min(min[i], p.co[i]);
              max[i] = Math.max(max[i], p.co[i]);
            }
          }
        }
      }
    }
    if (min[0] <= max[0]) this.cam.fit(min, max);
    this.latk = { layers };
    this.fileName = fileName;
    this.frameClock = 0;
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
    const now = performance.now() / 1000;
    const dt = Math.min(Math.max(now - this.lastTime, 0), MAX_DT);
    this.lastTime = now;
    this.spinYaw = wrapDegrees(this.spinYaw + dt * this.params.spin.value);
    this._setSound(Math.round(this.params.sound.value) === 1);
    this._applyEffects();

    this.outputFBO.begin();
    glCanvas.background(0);
    if (this.latk) {
      // ofxLatk's playback clock, accumulated so turning FPS doesn't jump it
      this.frameClock += dt * Math.max(0, this.params.fps.value);
      const steps = Math.floor(this.frameClock);
      this.frameClock -= steps;
      for (const layer of this.latk.layers) {
        if (layer.frames.length > 0) layer.counter = (layer.counter + steps) % layer.frames.length;
      }

      const cam = this.cam;
      cam.yaw = wrapDegrees(this.params.yaw.value + this.spinYaw) * Math.PI / 180;
      cam.pitch = this.params.pitch.value * Math.PI / 180;
      cam.distance = this.params.distance.value * cam.radius;

      // The whole round trip, every frame: strokes -> audio -> effects -> strokes
      const scope = this.scope;
      scope.loopFreq = this.params.loopHz.value;
      scope.beamSize = this.params.beamSize.value;
      scope.update(this.latk, cam, glCanvas.width, glCanvas.height);
      if (this.soundOn) this._feedPlayer();

      this._draw(glCanvas, Math.round(this.params.view.value));
    }
    this.outputFBO.end();
  }

  _draw(glCanvas, view) {
    const scope = this.scope;
    if (view === BEAMS) scope.beamStream();
    else if (view === STROKES) scope.strokeStream();
    else scope.lineStream();
    const n = scope.streamCount;
    if (n < 2 || !this._upload(glCanvas, scope.stream, n)) return;

    const H = glCanvas.height;
    const pxToScope = 2 / H;   // one output pixel, in scope units
    const s = view === BEAMS ? this.beamShader : this.lineShader;
    glCanvas.noStroke();
    glCanvas.shader(s);
    s.setUniform('uTexSize', [this.pointFBO.width, this.pointFBO.height]);
    s.setUniform('uLast', n - 1);
    s.setUniform('uAspect', glCanvas.width / H);
    if (view === BEAMS) {
      // The beams add up, as OsciMesh's did
      const size = this.params.beamSize.value * pxToScope;
      s.setUniform('uSize', size);
      s.setUniform('uIntensity', this.params.intensity.value * scope.beamExposure);
      glCanvas.blendMode(glCanvas.ADD);
    } else {
      const halfWidth = LINE_WIDTH / 2 * pxToScope;
      const feather = pxToScope / this.pixelDensity;
      s.setUniform('uSize', halfWidth + feather);
      s.setUniform('uHalfWidth', halfWidth);
      s.setUniform('uFeather', feather);
      glCanvas.blendMode(glCanvas.BLEND);
    }
    for (let base = 0; base < n - 1; base += TWO_BATCH) {
      // p5 points every sampler at an empty texture after each draw, so this
      // has to be set again for every batch
      s.setUniform('uPoints', this.pointFBO);
      s.setUniform('uBase', base);
      glCanvas.model(this.geometry);
    }
    glCanvas.blendMode(glCanvas.BLEND);
  }

  // p5 has no way to fill a texture from an array, so this writes straight into
  // pointFBO's colour texture, putting back the binding and unpack state it
  // touches, as SlowscanJam does
  _upload(glCanvas, data, n) {
    const fbo = this.pointFBO;
    // Without float textures p5 falls back to 8 bits, which can't hold the stream
    if (fbo.format === glCanvas.UNSIGNED_BYTE) {
      if (!this.warnedNoFloat) console.warn('Twoscilloscope: this browser has no float framebuffers');
      this.warnedNoFloat = true;
      return false;
    }
    const rows = Math.ceil(n / POINT_TEX_W);
    if (rows > fbo.height) fbo.resize(POINT_TEX_W, 1 << Math.ceil(Math.log2(rows)));

    const gl = glCanvas.drawingContext;
    const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
    const prevFlip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
    const prevPremul = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.bindTexture(gl.TEXTURE_2D, fbo.colorTexture);
    const full = Math.floor(n / POINT_TEX_W);
    const rest = n - full * POINT_TEX_W;
    if (full > 0) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, POINT_TEX_W, full, gl.RGBA, gl.FLOAT,
        data.subarray(0, full * POINT_TEX_W * 4));
    }
    if (rest > 0) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, full, rest, 1, gl.RGBA, gl.FLOAT,
        data.subarray(full * POINT_TEX_W * 4, n * 4));
    }
    gl.bindTexture(gl.TEXTURE_2D, prevTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, prevFlip);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, prevPremul);
    return true;
  }

  // ---------------------------------------------------------------- fullscreen

  // Dragging orbits, as the example's camera did, by turning the Yaw and Pitch knobs
  handleMouseDown(mx, my, canvasW, canvasH, button) {
    this.dragX = mx;
    this.dragY = my;
  }

  handleMouseDrag(mx, my, canvasW, canvasH) {
    if (this.dragX === null) return;
    const k = ORBIT_RATE * 180 / Math.PI;
    this.setParam('yaw', wrapDegrees(this.params.yaw.value - (mx - this.dragX) * k));
    this.setParam('pitch', this.params.pitch.value + (my - this.dragY) * k);
    this.dragX = mx;
    this.dragY = my;
  }

  handleMouseUp() {
    this.dragX = null;
    this.dragY = null;
  }

  // The wheel zooms by turning the Distance knob
  handleWheel(delta) {
    this.setParam('distance', this.params.distance.value * Math.exp(delta * ZOOM_RATE));
  }

  // A double-click goes back to the start, as the example's did
  handleDoubleClick() {
    this.setParam('yaw', 0);
    this.setParam('pitch', OrbitCamera.HOME_PITCH * 180 / Math.PI);
    this.setParam('distance', OrbitCamera.HOME_DISTANCE);
    this.spinYaw = 0;
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
    if (this.geometry) this.glCanvas.freeGeometry(this.geometry);
    if (this.pointFBO) this.pointFBO.remove();
    if (this.fileInput) this.fileInput.remove();
    this.geometry = null;
    this.pointFBO = null;
    super.dispose();
  }
}

function wrapDegrees(deg) {
  return ((deg + 180) % 360 + 360) % 360 - 180;
}

registerModule('Twoscilloscope', TwoscilloscopeModule);
