import { Module } from './Module.js';
import { lutFrag } from '../shaders/lut.js';
import { registerModule } from '../moduleRegistry.js';
import { parseCLF, compileCLF } from './lut/clf.js';

// Lattice points per axis of the baked 3D LUT
const BAKE_SIZE = 65;

export class LUTModule extends Module {
  constructor(glCanvas, id) {
    super('LUT', glCanvas, id);
    this.inputs = [{ name: 'in', type: 'video' }];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      mix: { value: 1, min: 0, max: 1, step: 0.01, label: 'Mix' },
    };
    this.lutImage = null;   // baked lattice, as an atlas of blue slices
    this.lutName = '';
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

  // Parse a CLF file and bake it; throws CLFError if the file is invalid
  loadCLF(text, fileName = '') {
    const { ops, warnings } = parseCLF(text);
    for (const w of warnings) console.warn(`${fileName}: ${w}`);
    this._bake(compileCLF(ops));
    this.lutName = fileName;   // shown on the file button
  }

  // Run the transform once per lattice point. Rendering is then one 3D LUT
  // lookup per pixel, however many nodes the file chains together.
  _bake(apply, n = BAKE_SIZE) {
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const w = cols * n, h = rows * n;
    if (!this.lutImage || this.lutImage.width !== w || this.lutImage.height !== h) {
      this.lutImage = this.glCanvas._pInst.createImage(w, h);
    }
    const img = this.lutImage;
    img.loadPixels();
    const px = img.pixels;
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
    img.updatePixels();
    this.lutSize = n;
    this.lutCols = cols;
  }

  process(graph, glCanvas) {
    const inputFBO = this.getInput(graph, 0);
    if (!inputFBO) return;
    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('tex0', inputFBO);
    // uLut always gets a real texture, the input until a LUT loads. Left unset,
    // p5 binds a placeholder, and the first time it creates one it lands on the
    // active texture unit, blanking tex0 for that frame.
    this.shader.setUniform('uLut', this.lutImage || inputFBO);
    if (this.lutImage) {
      this.shader.setUniform('uSize', this.lutSize);
      this.shader.setUniform('uCols', this.lutCols);
      this.shader.setUniform('uAtlasSize', [this.lutImage.width, this.lutImage.height]);
    }
    // Until a LUT loads, a mix of 0 passes the input through untouched (the shader skips the lookup)
    this.shader.setUniform('uMix', this.lutImage ? this.params.mix.value : 0);
    this.renderQuad();
    this.outputFBO.end();
  }

  dispose() {
    if (this.fileInput) this.fileInput.remove();
    this.lutImage = null;
    super.dispose();
  }
}

registerModule('LUT', LUTModule);
