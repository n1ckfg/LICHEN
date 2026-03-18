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

    // Cached line data
    this.lineData = [];
    this.lastScanStep = -1;
    this.lastDepth = -1;

    // Snapshot buffer to capture input frame
    this.snapshotImg = null;
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
    this.snapshotImg = inputFBO.get();
    this.snapshotImg.loadPixels();

    // Regenerate line data if params changed
    const scanStep = Math.round(this.getParam('scanStep'));
    const depth = this.getParam('depth');
    if (scanStep !== this.lastScanStep || depth !== this.lastDepth) {
      this.lastScanStep = scanStep;
      this.lastDepth = depth;
    }

    // Always regenerate lines from current frame
    this._createLines(this.snapshotImg, scanStep, depth);

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

    this.lineData = [];

    for (let y = 0; y < h; y += scanStep) {
      const line = [];
      for (let x = 0; x < w; x += scanStep) {
        const idx = (y * w + x) * 4;
        const r = pixels[idx];
        const g = pixels[idx + 1];
        const b = pixels[idx + 2];

        // Calculate brightness (same formula as sketch.js)
        const brightness = (0.34 * r + 0.5 * g + 0.16 * b) / 255;

        // Z displacement based on brightness
        const z = -brightness * depth + depth / 2;

        line.push({
          x: x - w / 2,
          y: y - h / 2,
          z: z,
          r: r,
          g: g,
          b: b
        });
      }
      this.lineData.push(line);
    }
  }

  _drawToGraphics() {
    const pg = this.pg;
    const scale = this.getParam('scale');
    const lineThickness = this.getParam('lineThickness');
    const opacity = this.getParam('opacity');
    const rotX = this.getParam('rotationX');
    const rotY = this.getParam('rotationY');

    pg.clear();
    pg.background(0);

    pg.push();

    // Apply scale
    pg.scale(scale);

    // Apply rotation
    pg.rotateX(rotX);
    pg.rotateY(rotY);

    // Flip Y to match coordinate system
    pg.scale(1, -1, 1);

    // Set up additive blending
    pg.blendMode(pg.ADD);

    // Draw lines
    pg.strokeWeight(lineThickness);
    pg.noFill();

    for (const line of this.lineData) {
      pg.beginShape();
      for (const pt of line) {
        const alpha = opacity * 255;
        pg.stroke(pt.r, pt.g, pt.b, alpha);
        pg.vertex(pt.x, pt.y, pt.z);
      }
      pg.endShape();
    }

    pg.blendMode(pg.BLEND);
    pg.pop();
  }

  dispose() {
    if (this.pg) this.pg.remove();
    if (this.snapshotImg) this.snapshotImg = null;
    super.dispose();
  }
}

registerModule('RuttEtra', RuttEtraModule);
