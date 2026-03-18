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
      // Performance parameters
      frameSkip: { value: 1, min: 1, max: 6, step: 1, label: 'Frame Skip' },
      adaptiveDetail: { value: 0, min: 0, max: 50, step: 1, label: 'Adaptive Detail' },
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

    // Frame skipping state
    this.frameCount = 0;
  }

  process(graph, glCanvas) {
    const inputFBO = this.getInput(graph, 0);
    if (!inputFBO) {
      this.outputFBO.begin();
      glCanvas.clear();
      this.outputFBO.end();
      return;
    }

    // Frame skipping - only process every N frames
    const frameSkip = Math.round(this.getParam('frameSkip'));
    this.frameCount++;

    if (this.frameCount >= frameSkip) {
      this.frameCount = 0;

      // Get input framebuffer as a p5.Image for pixel access
      const img = inputFBO.get();
      img.loadPixels();

      const scanStep = Math.round(this.getParam('scanStep'));
      const depth = this.getParam('depth');

      // Update line data from current frame
      this._createLines(img, scanStep, depth);

      // Draw 3D lines to WEBGL graphics buffer
      this._drawToGraphics();
    }

    // Always copy PG buffer to output (shows last rendered frame)
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

      // Pre-compute column X positions (reused for every row)
      this.colX = new Float32Array(cols);
      this.colPx = new Uint16Array(cols);
      for (let col = 0; col < cols; col++) {
        this.colX[col] = col * scanStep - halfW;
        this.colPx[col] = col * scanStep;
      }

      // Pre-compute static X/Y positions
      let idx = 0;
      for (let row = 0; row < rows; row++) {
        const y = row * scanStep - halfH;
        for (let col = 0; col < cols; col++) {
          this.dataX[idx] = this.colX[col];
          this.dataY[idx] = y;
          idx++;
        }
      }
    }

    // Local references for faster access
    const dataZ = this.dataZ;
    const dataR = this.dataR;
    const dataG = this.dataG;
    const dataB = this.dataB;
    const colPx = this.colPx;

    // Pre-compute constants
    const depthScale = -depth / 255;
    const rWeight = 0.34 * depthScale;
    const gWeight = 0.5 * depthScale;
    const bWeight = 0.16 * depthScale;

    // Update Z and colors each frame
    let idx = 0;
    for (let row = 0; row < rows; row++) {
      const rowOffset = row * scanStep * w * 4;
      for (let col = 0; col < cols; col++) {
        const pIdx = rowOffset + colPx[col] * 4;

        const r = pixels[pIdx];
        const g = pixels[pIdx + 1];
        const b = pixels[pIdx + 2];

        // Optimized brightness calculation (merged with depth scaling)
        dataZ[idx] = r * rWeight + g * gWeight + b * bWeight + halfDepth;
        dataR[idx] = r;
        dataG[idx] = g;
        dataB[idx] = b;
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
    const adaptiveDetail = this.getParam('adaptiveDetail');
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

    // Threshold for color change (reduces stroke() calls by ~80%)
    const colorThreshold = 16;

    for (let row = 0; row < rows; row++) {
      pg.beginShape();
      const rowStart = row * cols;

      // Reset tracking at start of each row
      let lastR = -999, lastG = -999, lastB = -999;
      let lastDrawnZ = -99999;
      let lastDrawnCol = -1;

      for (let col = 0; col < cols; col++) {
        const idx = rowStart + col;
        const z = dataZ[idx];

        // Adaptive detail: skip vertices with similar Z (low contrast regions)
        // Always draw first, last, and vertices with significant Z change
        const isFirst = col === 0;
        const isLast = col === cols - 1;
        const zDelta = z - lastDrawnZ;
        const significantChange = zDelta > adaptiveDetail || zDelta < -adaptiveDetail;

        if (isFirst || isLast || significantChange || adaptiveDetail === 0) {
          const r = dataR[idx];
          const g = dataG[idx];
          const b = dataB[idx];

          // Only update stroke if color changed significantly
          const dr = r - lastR;
          const dg = g - lastG;
          const db = b - lastB;
          if (dr > colorThreshold || dr < -colorThreshold ||
              dg > colorThreshold || dg < -colorThreshold ||
              db > colorThreshold || db < -colorThreshold) {
            pg.stroke(r, g, b, alpha);
            lastR = r;
            lastG = g;
            lastB = b;
          }

          pg.vertex(dataX[idx], dataY[idx], z);
          lastDrawnZ = z;
          lastDrawnCol = col;
        }
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
    this.colX = null;
    this.colPx = null;
    super.dispose();
  }
}

registerModule('RuttEtra', RuttEtraModule);
