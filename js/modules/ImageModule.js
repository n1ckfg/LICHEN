import { Module } from './Module.js';
import { passthroughFrag } from '../shaders/passthrough.js';
import { registerModule } from '../moduleRegistry.js';

export class ImageModule extends Module {
  static uid = '90ab4d59';

  constructor(glCanvas, id) {
    super('Image', glCanvas, id);
    this.outputs = [{ id: '6382', name: 'out', type: 'video' }];
    this.params = {
      width:  { id: '798b', value: 0, min: 0, max: 7680, step: 1, label: 'Width' },
      height: { id: '310a', value: 0, min: 0, max: 4320, step: 1, label: 'Height' },
    };
    this.img = null;
    this.imgReady = false;
    this.createShader(passthroughFrag);
    this.createOutputFBO();
    this._createFileInput();
  }

  _createFileInput() {
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'image/*';
    this.fileInput.style.display = 'none';
    document.body.appendChild(this.fileInput);
    this.fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) this.loadImage(file);
    });
  }

  pickFile() {
    this.fileInput.click();
  }

  loadImage(file) {
    const url = URL.createObjectURL(file);
    const p = this.glCanvas._pInst;
    p.loadImage(url, (img) => {
      this.img = img;

      // Set width/height params to the image's native dimensions
      this.params.width.value = img.width;
      this.params.height.value = img.height;

      if (!this.pg) {
        this.pg = p.createGraphics(this.glCanvas.width, this.glCanvas.height);
      }
      this.imgReady = true;

      URL.revokeObjectURL(url);
    });
  }

  process(graph, glCanvas) {
    if (!this.imgReady || !this.img || !this.pg) return;

    // Redraw the image into pg at the user-specified dimensions, centered
    const w = this.params.width.value;
    const h = this.params.height.value;
    this.pg.background(0);
    this.pg.image(this.img,
      (this.pg.width - w) / 2, (this.pg.height - h) / 2,
      w, h);

    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('tex0', this.pg);
    this.renderQuad();
    this.outputFBO.end();
  }

  dispose() {
    if (this.pg) this.pg.remove();
    if (this.fileInput) this.fileInput.remove();
    super.dispose();
  }
}

registerModule('Image', ImageModule);
