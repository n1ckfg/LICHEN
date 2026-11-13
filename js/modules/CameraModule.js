import { Module } from './Module.js';
import { vertSrc } from '../shaders/vert.js';
import { passthroughFrag, passthroughMirrorFrag } from '../shaders/passthrough.js';
import { registerModule } from '../moduleRegistry.js';

// What the Resolution and Frame Rate menus offer, where the device reaches.
// A browser can't list a camera's own modes, only the range of each setting
// (track.getCapabilities()), and Chrome scales and crops to anything inside it.
const RESOLUTIONS = [
  [160, 120], [320, 240], [640, 360], [640, 480], [800, 600], [960, 540], [1024, 768],
  [1280, 720], [1280, 960], [1600, 1200], [1920, 1080], [2560, 1440], [3840, 2160],
];
const FRAME_RATES = [5, 10, 15, 24, 25, 30, 50, 60, 90, 120, 240];
const MENUS = ['device', 'resolution', 'fps'];

const mediaDevices = () => globalThis.navigator?.mediaDevices;

export class CameraModule extends Module {
  static uid = '21b607f9';

  constructor(glCanvas, id) {
    super('Camera', glCanvas, id);
    this.outputs = [{ id: '3261', name: 'out', type: 'video' }];
    // Each menu's option 0 is Default: ask for nothing, as Camera did before
    // the menus. The rest are rebuilt as devices and capabilities are learnt.
    this.params = {
      device: { id: '3eb9', value: 0, min: 0, max: 0, step: 1, label: 'Device', widget: 'dropdown', valueLabels: ['Default'] },
      resolution: { id: '1fdc', value: 0, min: 0, max: 0, step: 1, label: 'Resolution', widget: 'dropdown', valueLabels: ['Default'] },
      fps: { id: '3342', value: 0, min: 0, max: 0, step: 1, label: 'Frame Rate', widget: 'dropdown', valueLabels: ['Default'] },
      // Flips the picture left to right, as a selfie view shows it. A plain
      // param, saved by index: unlike the menus above, its options are the same
      // on every machine.
      mirror: { id: '13b3', value: 0, min: 0, max: 1, step: 1, label: 'Mirror', widget: 'dropdown', valueLabels: ['Off', 'On'] },
    };
    // What the menus ask for, by meaning rather than index, since the options
    // differ from machine to machine. This is what a patch saves (saveState).
    this.wanted = { device: null, resolution: null, fps: null };
    this.devices = [];      // { id, label } for each video input
    this.capabilities = null;
    this.options = {};      // per menu, the value behind each option
    this._seen = {};        // per menu, the index the options were last built at
    this.capture = null;
    this.captureReady = false;
    this.createShader(passthroughFrag);
    this.mirrorShader = glCanvas.createShader(vertSrc, passthroughMirrorFrag);
    this.createOutputFBO();
    this._buildMenus();

    this._onDeviceChange = () => this._listDevices();
    mediaDevices()?.addEventListener?.('devicechange', this._onDeviceChange);
    this._listDevices();
    // Open after the task that built the node, so a patch's saved choices
    // (loadState) are in before the first request, not reopened after it
    queueMicrotask(() => { if (!this.disposed && !this.capture) this._open(); });
  }

  // getUserMedia's video constraints for what the menus ask. Default on all
  // three is `true`, the request Camera always made.
  _constraints() {
    const { device, resolution, fps } = this.wanted;
    const video = {};
    if (device) {
      // exact when the device is here; otherwise prefer it, and take another
      const present = this.devices.some(d => d.id === device.id);
      video.deviceId = present ? { exact: device.id } : { ideal: device.id };
    }
    if (resolution) {
      video.width = { ideal: resolution[0] };
      video.height = { ideal: resolution[1] };
    }
    if (fps) video.frameRate = { ideal: fps };
    return Object.keys(video).length ? video : true;
  }

  // (Re)open the capture for what the menus ask. A device can't be changed on
  // a running track, so every change opens a new one; the output holds its last
  // frame until the new one is ready.
  _open() {
    this._closeCapture();
    try {
      const p = this.glCanvas._pInst;
      const cap = p.createCapture({ video: this._constraints(), audio: false }, (stream) => {
        // A capture replaced before it was ready still got its stream
        if (cap !== this.capture) {
          stream?.getTracks?.().forEach(t => t.stop());
          return;
        }
        this.captureReady = true;
        this._readCapabilities();
        // Labels and ids are only given once the camera is allowed
        this._listDevices();
      });
      this.capture = cap;
      cap.size(this.glCanvas.width, this.glCanvas.height);
      cap.hide();
    } catch (e) {
      console.warn('Camera not available:', e);
    }
  }

  _closeCapture() {
    if (this.capture) this.capture.remove();
    this.capture = null;
    this.captureReady = false;
  }

  _track() {
    return this.capture?.elt?.srcObject?.getVideoTracks?.()[0] ?? null;
  }

  _readCapabilities() {
    const track = this._track();
    this.capabilities = track?.getCapabilities ? track.getCapabilities() : null;
    this._buildMenus();
  }

  async _listDevices() {
    const md = mediaDevices();
    if (!md?.enumerateDevices) return;
    let all;
    try {
      all = await md.enumerateDevices();
    } catch (e) {
      return;
    }
    if (this.disposed) return;
    // Before the camera is allowed, Chrome lists one input with no id
    this.devices = all
      .filter(d => d.kind === 'videoinput' && d.deviceId)
      .map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` }));
    this._buildMenus();
    // A device asked for but missing when the capture opened may be back
    const want = this.wanted.device;
    const track = this._track();
    if (want && track && this.devices.some(d => d.id === want.id)) {
      const using = track.getSettings?.().deviceId;
      if (using && using !== want.id) this._open();
    }
  }

  // Rebuild each menu's options and labels, and point it at what is wanted.
  // A saved choice this machine or device doesn't list is shown anyway, so it
  // isn't silently dropped: a missing device as not found, a size or rate
  // outside the device's range as asked (the browser gives the nearest).
  _buildMenus() {
    const { device, resolution, fps } = this.wanted;

    const devices = [...this.devices];
    // A saved id may be another machine's: match its name then
    const match = device && (devices.find(d => d.id === device.id) || devices.find(d => d.label === device.label));
    if (match && match.id !== device.id) this.wanted.device = { ...match };
    if (device && !match) devices.push({ ...device, missing: true });
    this._setMenu('device',
      [null, ...devices],
      ['Default', ...devices.map(d => d.missing ? `${d.label} (not found)` : d.label)],
      device ? 1 + devices.findIndex(d => d.id === this.wanted.device.id) : 0);

    const caps = this.capabilities;
    const fits = (v, range) => !range || ((range.min ?? 0) <= v + 0.5 && v - 0.5 <= (range.max ?? Infinity));
    const sizes = RESOLUTIONS.filter(([w, h]) => fits(w, caps?.width) && fits(h, caps?.height));
    if (resolution && !sizes.some(([w, h]) => w === resolution[0] && h === resolution[1])) {
      sizes.push(resolution);
      sizes.sort((a, b) => a[0] * a[1] - b[0] * b[1] || a[0] - b[0]);
    }
    this._setMenu('resolution',
      [null, ...sizes],
      ['Default', ...sizes.map(([w, h]) => `${w}×${h}`)],
      resolution ? 1 + sizes.findIndex(([w, h]) => w === resolution[0] && h === resolution[1]) : 0);

    const rates = FRAME_RATES.filter(r => fits(r, caps?.frameRate));
    if (fps && !rates.includes(fps)) {
      rates.push(fps);
      rates.sort((a, b) => a - b);
    }
    this._setMenu('fps',
      [null, ...rates],
      ['Default', ...rates.map(r => `${r} fps`)],
      fps ? 1 + rates.indexOf(fps) : 0);
  }

  _setMenu(name, values, labels, index) {
    const p = this.params[name];
    this.options[name] = values;
    p.valueLabels = labels;
    p.max = labels.length - 1;
    p.value = index;
    this._seen[name] = index;
  }

  // A menu moved by a click or a cable since its options were built asks for
  // its new option, and the capture reopens for it
  _checkMenus() {
    let changed = false;
    for (const name of MENUS) {
      const i = Math.round(this.params[name].value);
      if (i === this._seen[name]) continue;
      this._seen[name] = i;
      const v = this.options[name][i];
      if (v === undefined) continue;
      this.wanted[name] = v === null ? null : (name === 'device' ? { id: v.id, label: v.label } : v);
      changed = true;
    }
    if (!changed) return;
    // A device's capabilities are learnt again once it opens
    if (this.wanted.device?.id !== this._track()?.getSettings?.().deviceId) this.capabilities = null;
    this._buildMenus();
    this._open();
  }

  process(graph, glCanvas) {
    this._checkMenus();
    if (!this.capture || !this.captureReady) return;
    if (this.capture.loadedmetadata === false) return;
    // A cable on Mirror rounds to an option, as the menu's box does
    const shader = Math.round(this.params.mirror.value) === 1 ? this.mirrorShader : this.shader;
    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(shader);
    shader.setUniform('tex0', this.capture);
    this.renderQuad();
    this.outputFBO.end();
  }

  frameResized(w, h) {
    if (this.capture) this.capture.size(w, h);
  }

  saveState() {
    const { device, resolution, fps } = this.wanted;
    if (!device && !resolution && !fps) return null;
    return { device, resolution, fps };
  }

  loadState(state) {
    this.wanted = {
      device: state?.device ?? null,
      resolution: state?.resolution ?? null,
      fps: state?.fps ?? null,
    };
    this._buildMenus();
    // Already open (a node duplicated after its first frame): open for these
    if (this.capture) this._open();
  }

  dispose() {
    this.disposed = true;
    mediaDevices()?.removeEventListener?.('devicechange', this._onDeviceChange);
    this._closeCapture();
    this.mirrorShader = null;
    super.dispose();
  }
}

registerModule('Camera', CameraModule);
