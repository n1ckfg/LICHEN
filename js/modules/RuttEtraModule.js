import { Module } from './Module.js';
import { passthroughFrag } from '../shaders/passthrough.js';
import { registerModule } from '../moduleRegistry.js';

export class RuttEtraModule extends Module {
  constructor(glCanvas, id) {
    super('RuttEtra', glCanvas, id);
    this.inputs = [{ name: 'in', type: 'video' }];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      scale: { value: 1.0, min: 0.1, max: 4, step: 0.1, label: 'Scale' },
      scanStep: { value: 4, min: 1, max: 20, step: 1, label: 'Line Separation' },
      lineThickness: { value: 2.0, min: 0.5, max: 10, step: 0.5, label: 'Line Thickness' },
      opacity: { value: 1.0, min: 0, max: 1, step: 0.05, label: 'Brightness' },
      depth: { value: 80, min: 0, max: 300, step: 1, label: 'Max Line Depth' },
      rotationX: { value: 0.3, min: -1.5, max: 1.5, step: 0.05, label: 'Rotation X' },
      rotationY: { value: 0, min: -1.5, max: 1.5, step: 0.05, label: 'Rotation Y' },
    };

    const p = glCanvas._pInst;
    const w = glCanvas.width;
    const h = glCanvas.height;

    // Create WEBGL graphics buffer for 3D rendering
    this.pg = p.createGraphics(w, h, p.WEBGL);

    // Create shader and FBO for output
    this.createShader(passthroughFrag);
    this.createOutputFBO();

    // Cached dimensions
    this.lastScanStep = -1;
    this.cols = 0;
    this.rows = 0;

    // Pre-allocated typed arrays (much faster than object arrays)
    this.dataX = null;
    this.dataY = null;
    this.dataZ = null;
    this.dataR = null;
    this.dataG = null;
    this.dataB = null;
  }

  process(graph, glCanvas) {
    const inputFBO = this.getInput(graph, 0);
    if (!inputFBO) {
      this.outputFBO.begin();
      glCanvas.clear();
      this.outputFBO.end();
      return;
    }

    // Get input framebuffer as a p5.Image for pixel access
    const img = inputFBO.get();
    img.loadPixels();

    const scanStep = Math.round(this.getParam('scanStep'));
    const depth = this.getParam('depth');

    // Update line data from current frame
    this._createLines(img, scanStep, depth);

    // Draw 3D lines to WEBGL graphics buffer
    this._drawToGraphics();

    // Copy PG buffer to output FBO
    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('tex0', this.pg);
    this.renderQuad();
    this.outputFBO.end();
  }

  _createLines(img, scanStep, depth) {
    const w = img.width;
    const h = img.height;
    const pixels = img.pixels;
    const halfW = w / 2;
    const halfH = h / 2;
    const halfDepth = depth / 2;

    const rows = Math.floor(h / scanStep);
    const cols = Math.floor(w / scanStep);
    const total = rows * cols;

    // Reallocate typed arrays if grid size changed
    if (this.rows !== rows || this.cols !== cols) {
      this.rows = rows;
      this.cols = cols;
      this.dataX = new Float32Array(total);
      this.dataY = new Float32Array(total);
      this.dataZ = new Float32Array(total);
      this.dataR = new Uint8Array(total);
      this.dataG = new Uint8Array(total);
      this.dataB = new Uint8Array(total);

      // Pre-compute static X/Y positions
      let idx = 0;
      for (let row = 0; row < rows; row++) {
        const y = row * scanStep - halfH;
        for (let col = 0; col < cols; col++) {
          const x = col * scanStep - halfW;
          this.dataX[idx] = x;
          this.dataY[idx] = y;
          idx++;
        }
      }
    }

    // Update Z and colors each frame
    let idx = 0;
    for (let row = 0; row < rows; row++) {
      const py = row * scanStep;
      for (let col = 0; col < cols; col++) {
        const px = col * scanStep;
        const pIdx = (py * w + px) * 4;

        const r = pixels[pIdx];
        const g = pixels[pIdx + 1];
        const b = pixels[pIdx + 2];

        const brightness = (0.34 * r + 0.5 * g + 0.16 * b) / 255;

        this.dataZ[idx] = -brightness * depth + halfDepth;
        this.dataR[idx] = r;
        this.dataG[idx] = g;
        this.dataB[idx] = b;
        idx++;
      }
    }
  }

  _drawToGraphics() {
    const pg = this.pg;
    const scale = this.getParam('scale');
    const lineThickness = this.getParam('lineThickness');
    const opacity = this.getParam('opacity');
    const rotX = this.getParam('rotationX');
    const rotY = this.getParam('rotationY');
    const alpha = opacity * 255;

    const rows = this.rows;
    const cols = this.cols;
    const dataX = this.dataX;
    const dataY = this.dataY;
    const dataZ = this.dataZ;
    const dataR = this.dataR;
    const dataG = this.dataG;
    const dataB = this.dataB;

    pg.clear();
    pg.background(0);

    pg.push();

    // Apply scale
    pg.scale(scale);

    // Apply rotation
    pg.rotateX(rotX);
    pg.rotateY(rotY);

    // Set up additive blending
    pg.blendMode(pg.ADD);

    // Draw lines
    pg.strokeWeight(lineThickness);
    pg.noFill();

    for (let row = 0; row < rows; row++) {
      pg.beginShape();
      const rowStart = row * cols;
      for (let col = 0; col < cols; col++) {
        const idx = rowStart + col;
        pg.stroke(dataR[idx], dataG[idx], dataB[idx], alpha);
        pg.vertex(dataX[idx], dataY[idx], dataZ[idx]);
      }
      pg.endShape();
    }

    pg.blendMode(pg.BLEND);
    pg.pop();
  }

  dispose() {
    if (this.pg) this.pg.remove();
    this.dataX = null;
    this.dataY = null;
    this.dataZ = null;
    this.dataR = null;
    this.dataG = null;
    this.dataB = null;
    super.dispose();
  }
}

registerModule('RuttEtra', RuttEtraModule);
