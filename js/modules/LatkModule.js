import { Module } from './Module.js';
import { registerModule } from '../moduleRegistry.js';
import { OrbitCamera } from './latk/OrbitCamera.js';
import { readLatk } from './latk/readLatk.js';
import { projectFrame, PointStream, XYOutputs } from './latk/strokes.js';
import { SegmentRenderer } from './latk/SegmentRenderer.js';

const SAMPLE_RATE = 44100;   // of the X and Y outputs
const MAX_DT = 0.1;          // clamp long stalls so a tab switch doesn't jump the clocks
const ORBIT_RATE = 0.01;     // example-latk's drag rate, radians per pixel
const ZOOM_RATE = 0.001;     // and its wheel: distance x exp(delta x ZOOM_RATE)

// The .latk files bundled in files/latk, in drop-down order after option 0.
// Patches save the preset as its index, so new files are appended, never inserted.
const PRESET_DIR = new URL('../../files/latk/', import.meta.url);
const PRESETS = [
  'flower.latk',
  'jellyfish.latk',
  'kinect_guy.latk',
  'latk_logo.latk',
];
const NO_FILE_LABEL = 'None';

// Preset index -> promise of parsed layers. Shared by every Latk node; each
// node gets fresh layer wrappers so its playback counter stays independent.
const presetCache = new Map();
const presetAlerted = new Set();

function loadPreset(k) {
  if (!presetCache.has(k)) {
    const file = PRESETS[k];
    presetCache.set(k, fetch(new URL(file, PRESET_DIR))
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.arrayBuffer();
      })
      .then((buf) => readLatk(buf))
      .catch((err) => {
        presetCache.delete(k);
        throw err;
      }));
  }
  return presetCache.get(k);
}

function cloneLayers(layers) {
  return layers.map((layer) => ({ ...layer, counter: 0 }));
}

// A Latk drawing (Lightning Artist Toolkit), played back and drawn as lines in
// its strokes' colours, seen through an orbiting camera. This is the player
// from Twoscilloscope's example-latk without the oscilloscope. Its X and Y
// outputs carry each frame as one loop of XY audio, as the example encoded it,
// to drive Twoscilloscope.
export class LatkModule extends Module {
  static uid = '32a408d8';

  constructor(glCanvas, id) {
    super('Latk', glCanvas, id);
    this.outputs = [
      { id: '3fd9', name: 'out', type: 'video' },
      { id: '4c65', name: 'x', type: 'control' },
      { id: 'd1e6', name: 'y', type: 'control' },
    ];
    this.historicalInfo = 'Latk';
    // Option 0 is the file loaded with the button, named after it once there
    // is one; the rest are the bundled presets.
    this.params = {
      preset: {
        id: '60f3', value: 0, min: 0, max: PRESETS.length, step: 1, label: 'File',
        widget: 'dropdown', valueLabels: [NO_FILE_LABEL, ...PRESETS],
      },
      fps: { id: '9083', value: 12, min: 0, max: 60, step: 1, label: 'FPS' },   // ofxLatk's 12 frames a second
      yaw: { id: '180c', value: 0, min: -180, max: 180, step: 1, label: 'Yaw' },
      pitch: { id: '9432', value: OrbitCamera.HOME_PITCH * 180 / Math.PI, min: -89, max: 89, step: 1, label: 'Pitch' },
      // In radii of the drawing, so it fits whatever its size
      distance: {
        id: 'cd55', value: OrbitCamera.HOME_DISTANCE, min: OrbitCamera.MIN_DISTANCE, max: OrbitCamera.MAX_DISTANCE, step: 0.01,
        label: 'Distance',
      },
      spin: { id: '3b03', value: 0, min: -90, max: 90, step: 1, label: 'Spin' },
      width: { id: '5ee2', value: 2, min: 0.5, max: 10, step: 0.1, label: 'Width' },   // example-latk's strokeWeight
      // Loops a second on X and Y. A lower rate gives the drawing more samples
      loopHz: { id: '2b16', value: 5, min: 1, max: 100, step: 0.1, label: 'Loop Hz' },
    };

    this.segments = new SegmentRenderer(glCanvas, 'Latk');
    // The lines are geometry, so the output keeps p5's MSAA (see Framebuffers in ARCHITECTURE.md)
    this.outputFBO = glCanvas.createFramebuffer();
    this.stream = new PointStream();
    this.xy = new XYOutputs(SAMPLE_RATE);

    this.cam = new OrbitCamera();
    this.latk = null;         // { layers } once a drawing is in
    this.fileName = '';       // the file loaded with the button, shown on it
    this.fileLayers = null;   // that file's parsed layers, kept for option 0
    this._shownPreset = 0;    // the option the active drawing belongs to
    this._loadToken = 0;      // so a slow preset can't land after a newer choice
    this._disposed = false;
    this.frameClock = 0;      // Latk frames still to advance
    this.spinYaw = 0;         // degrees turned by Spin, added to the Yaw knob
    this.dragX = null;        // last fullscreen drag position, null when not dragging
    this.dragY = null;
    this.lastTime = performance.now() / 1000;

    this._createFileInput();
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
    const token = ++this._loadToken;
    try {
      const layers = await readLatk(await file.arrayBuffer());
      if (this._disposed || token !== this._loadToken) return;
      this.fileLayers = layers;
      this.fileName = file.name;
      this.params.preset.valueLabels[0] = file.name || NO_FILE_LABEL;
      this.setParam('preset', 0);
      this._shownPreset = 0;
      this._loadToken++;
      this._setDrawing(cloneLayers(layers));
    } catch (e) {
      // Keep whatever drawing was loaded before
      alert(`Could not load ${file.name}: ${e.message}`);
    }
    this.fileInput.value = '';   // so picking the same file again still fires 'change'
  }

  // Follow the drop-down, whether a click or a cable moved it. Presets load
  // asynchronously; the previous drawing stays on until the new one is ready.
  _syncPreset() {
    const k = Math.max(0, Math.min(PRESETS.length, Math.round(this.params.preset.value)));
    if (k === this._shownPreset) return;
    this._shownPreset = k;
    const token = ++this._loadToken;
    if (k === 0) {
      if (this.fileLayers) this._setDrawing(cloneLayers(this.fileLayers));
      else this._clearDrawing();
      return;
    }
    const file = PRESETS[k - 1];
    loadPreset(k - 1).then(
      (layers) => {
        if (!this._disposed && token === this._loadToken) this._setDrawing(cloneLayers(layers));
      },
      (e) => {
        console.error(`Could not load Latk preset ${file}:`, e);
        // Once per preset, so a cable sweeping the menu can't stack alerts
        if (!presetAlerted.has(k)) {
          presetAlerted.add(k);
          alert(`Could not load ${file}: ${e.message}`);
        }
      },
    );
  }

  _clearDrawing() {
    this.latk = null;
    this.frameClock = 0;
  }

  // The camera looks at the whole drawing, every frame of it, as example-latk's
  // frameDrawing() did
  _setDrawing(layers) {
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
    this.frameClock = 0;
  }

  process(graph, glCanvas) {
    this._syncPreset();
    const now = performance.now() / 1000;
    const dt = Math.min(Math.max(now - this.lastTime, 0), MAX_DT);
    this.lastTime = now;
    this.spinYaw = wrapDegrees(this.spinYaw + dt * this.params.spin.value);

    const w = glCanvas.width, h = glCanvas.height;
    let pieces = [];
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

      // The current frame of each layer through the camera
      pieces = projectFrame(this.latk, cam.getModelViewProjectionMatrix(w, h), w, h);
      this.stream.addPieces(pieces, w, h);
      this.segments.drawLines(this.stream, this.params.width.value, this.pixelDensity);
    }
    this.outputFBO.end();

    // The frame as one loop of XY audio on the X and Y outputs, both carrying
    // its blanking and stroke colours. Before a drawing is in, the loop is all
    // blank, so the beam rests unlit in the middle.
    this.xy.publish(this, pieces, w, h, dt, this.params.loopHz.value);
  }

  // ---------------------------------------------------------------- fullscreen

  // Dragging orbits, as example-latk's camera did, by turning the Yaw and Pitch knobs
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

  // A double-click goes back to the start, as example-latk's did
  handleDoubleClick() {
    this.setParam('yaw', 0);
    this.setParam('pitch', OrbitCamera.HOME_PITCH * 180 / Math.PI);
    this.setParam('distance', OrbitCamera.HOME_DISTANCE);
    this.spinYaw = 0;
  }

  dispose() {
    this._disposed = true;
    this._loadToken++;
    this.fileLayers = null;
    this.segments.dispose();
    if (this.fileInput) this.fileInput.remove();
    super.dispose();
  }
}

function wrapDegrees(deg) {
  return ((deg + 180) % 360 + 360) % 360 - 180;
}

registerModule('Latk', LatkModule);
