import { Module } from './Module.js';
import { lutFrag } from '../shaders/lut.js';
import { registerModule } from '../moduleRegistry.js';
import { parseCLF, compileCLF } from './lut/clf.js';

// Lattice points per axis of the baked 3D LUT
const BAKE_SIZE = 65;

// The LUTs bundled in files/luts, in drop-down order after option 0. Patches
// save the preset as its index, so new files are appended, never inserted.
const PRESET_DIR = new URL('../../files/luts/', import.meta.url);
const PRESETS = [
  { file: 'FG_CineBasic.clf', label: 'Cine Basic' },
  { file: 'FG_CineBright.clf', label: 'Cine Bright' },
  { file: 'FG_CineCold.clf', label: 'Cine Cold' },
  { file: 'FG_CineDrama.clf', label: 'Cine Drama' },
  { file: 'FG_CineTealOrange1.clf', label: 'Cine Teal Orange 1' },
  { file: 'FG_CineTealOrange2.clf', label: 'Cine Teal Orange 2' },
  { file: 'FG_CineVibrant.clf', label: 'Cine Vibrant' },
  { file: 'FG_CineWarm.clf', label: 'Cine Warm' },
];
const NO_FILE_LABEL = 'None';

// Preset index -> promise of its bake. Shared by every LUT node, so each
// preset is fetched and baked at most once per session.
const presetBakes = new Map();
const presetAlerted = new Set();

function loadPreset(k) {
  if (!presetBakes.has(k)) {
    const { file } = PRESETS[k];
    presetBakes.set(k, fetch(new URL(file, PRESET_DIR))
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then(text => bakeCLF(text, file)));
  }
  return presetBakes.get(k);
}

// Parse a CLF file and bake it; throws CLFError if the file is invalid
function bakeCLF(text, fileName) {
  const { ops, warnings } = parseCLF(text);
  for (const w of warnings) console.warn(`${fileName}: ${w}`);
  return bakeLattice(compileCLF(ops));
}

// Run the transform once per lattice point. Rendering is then one 3D LUT
// lookup per pixel, however many nodes the file chains together. The result
// is an atlas of blue slices, as raw RGBA bytes.
function bakeLattice(apply, n = BAKE_SIZE) {
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const w = cols * n, h = rows * n;
  const px = new Uint8ClampedArray(w * h * 4);
  const c = new Float64Array(3);
  for (let b = 0; b < n; b++) {
    const x0 = (b % cols) * n, y0 = Math.floor(b / cols) * n;
    for (let g = 0; g < n; g++) {
      for (let r = 0; r < n; r++) {
        c[0] = r / (n - 1); c[1] = g / (n - 1); c[2] = b / (n - 1);
        apply(c);
        // Uint8ClampedArray clamps to 0-255 and turns NaN into 0
        const i = ((y0 + g) * w + x0 + r) * 4;
        px[i] = c[0] * 255; px[i + 1] = c[1] * 255; px[i + 2] = c[2] * 255; px[i + 3] = 255;
      }
    }
  }
  return { pixels: px, w, h, size: n, cols };
}

export class LUTModule extends Module {
  static uid = 'ccf14f8f';

  constructor(glCanvas, id) {
    super('LUT', glCanvas, id);
    this.inputs = [{ id: 'd19a', name: 'in', type: 'video' }];
    this.outputs = [{ id: '83ec', name: 'out', type: 'video' }];
    // Option 0 is the file loaded with the button, named after it once there
    // is one; the rest are the bundled presets.
    this.params = {
      preset: {
        id: 'a5f8', value: 0, min: 0, max: PRESETS.length, step: 1, label: 'LUT', widget: 'dropdown',
        valueLabels: [NO_FILE_LABEL, ...PRESETS.map(p => p.label)],
      },
      mix: { id: '50f2', value: 1, min: 0, max: 1, step: 0.01, label: 'Mix' },
    };
    this.lutImage = null;   // the active bake, as a texture
    this.lutReady = false;  // false passes the input through untouched
    this.lutName = '';      // the file loaded with the button, shown on it
    this.fileBake = null;   // that file's bake, kept for option 0
    this._shownPreset = 0;  // the option the active bake belongs to
    this._loadToken = 0;    // so a slow preset can't land after a newer choice
    this.createShader(lutFrag);
    this.createOutputFBO();
    this._createFileInput();
  }

  _createFileInput() {
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.clf,.xml';
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
      this.loadCLF(await file.text(), file.name);
    } catch (e) {
      // Keep whatever LUT was loaded before
      alert(`Could not load ${file.name}: ${e.message}`);
    }
    this.fileInput.value = '';   // so picking the same file again still fires 'change'
  }

  // Load a file into option 0 and switch to it; throws CLFError if the file
  // is invalid. A cable on the drop-down can switch straight back.
  loadCLF(text, fileName = '') {
    this.fileBake = bakeCLF(text, fileName);
    this.lutName = fileName;
    this.params.preset.valueLabels[0] = fileName || NO_FILE_LABEL;
    this.setParam('preset', 0);
    this._shownPreset = 0;
    this._loadToken++;
    this._useBake(this.fileBake);
  }

  // Follow the drop-down, whether a click or a cable moved it. Presets load
  // asynchronously; the previous LUT stays on until the new one is baked.
  _syncPreset() {
    const k = Math.round(this.params.preset.value);
    if (k === this._shownPreset) return;
    this._shownPreset = k;
    const token = ++this._loadToken;
    if (k === 0) {
      this._useBake(this.fileBake);
      return;
    }
    const { label } = PRESETS[k - 1];
    loadPreset(k - 1).then(
      bake => { if (token === this._loadToken) this._useBake(bake); },
      e => {
        console.error(`Could not load LUT preset ${label}:`, e);
        // Once per preset, so a cable sweeping the menu can't stack alerts
        if (!presetAlerted.has(k)) {
          presetAlerted.add(k);
          alert(`Could not load ${label}: ${e.message}`);
        }
      });
  }

  // Upload a bake to the LUT texture, or pass through on null
  _useBake(bake) {
    if (!bake) {
      this.lutReady = false;
      return;
    }
    if (!this.lutImage || this.lutImage.width !== bake.w || this.lutImage.height !== bake.h) {
      this.lutImage = this.glCanvas._pInst.createImage(bake.w, bake.h);
    }
    const img = this.lutImage;
    img.loadPixels();
    img.pixels.set(bake.pixels);
    img.updatePixels();
    this.lutSize = bake.size;
    this.lutCols = bake.cols;
    this.lutReady = true;
  }

  process(graph, glCanvas) {
    this._syncPreset();
    const inputFBO = this.getInput(graph, 0);
    if (!inputFBO) return;
    const ready = this.lutReady;
    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('tex0', inputFBO);
    // uLut always gets a real texture, the input while no LUT is active. Left
    // unset, p5 binds a placeholder, and the first time it creates one it
    // lands on the active texture unit, blanking tex0 for that frame.
    this.shader.setUniform('uLut', ready ? this.lutImage : inputFBO);
    if (ready) {
      this.shader.setUniform('uSize', this.lutSize);
      this.shader.setUniform('uCols', this.lutCols);
      this.shader.setUniform('uAtlasSize', [this.lutImage.width, this.lutImage.height]);
    }
    // With no LUT active, a mix of 0 passes the input through untouched (the shader skips the lookup)
    this.shader.setUniform('uMix', ready ? this.params.mix.value : 0);
    this.renderQuad();
    this.outputFBO.end();
  }

  dispose() {
    if (this.fileInput) this.fileInput.remove();
    this.lutImage = null;
    this.fileBake = null;
    super.dispose();
  }
}

registerModule('LUT', LUTModule);
