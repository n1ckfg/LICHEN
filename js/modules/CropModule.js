import { Module } from './Module.js';
import { cropFrag } from '../shaders/crop.js';
import { registerModule } from '../moduleRegistry.js';

const FLASH_MS = 450;    // how long the box flashes once it is drawn
const BLINK_MS = 75;     // each on or off of the flash

// What the box's picture fills, in drop-down order. Patches save the mode as
// its index, so append, never insert.
const FLOATING = 0;      // left where it is, black round it
const FIT = 1;           // stretched to the whole frame

export class CropModule extends Module {
  static uid = '51e89489';

  constructor(glCanvas, id) {
    super('Crop', glCanvas, id);
    this.inputs = [{ id: '3756', name: 'in', type: 'video' }];
    this.outputs = [{ id: 'd1a5', name: 'out', type: 'video' }];
    this.params = {
      x: { id: '1dc8', value: 0, min: 0, max: 640, step: 1, label: 'X' },
      y: { id: '658f', value: 0, min: 0, max: 480, step: 1, label: 'Y' },
      width: { id: 'bff1', value: 640, min: 0, max: 640, step: 1, label: 'Width' },
      height: { id: '60a8', value: 480, min: 0, max: 480, step: 1, label: 'Height' },
      mode: {
        id: '2894', value: FLOATING, min: 0, max: 1, step: 1, label: 'Mode', widget: 'dropdown',
        valueLabels: ['Floating', 'Fit'],
      },
    };
    this.inputFBO = null;
    // The box being drawn in fullscreen, in frame pixels: { x0, y0, x1, y1 }
    this.box = null;
    this.flashStart = 0;
    this.createShader(cropFrag);
    this.createOutputFBO();
  }

  process(graph, glCanvas) {
    const inputFBO = this.getInput(graph, 0);
    this.inputFBO = inputFBO;
    if (!inputFBO) return;

    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('tex0', inputFBO);
    this.shader.setUniform('uResolution', [glCanvas.width, glCanvas.height]);
    this.shader.setUniform('uCorner', [this.params.x.value, this.params.y.value]);
    this.shader.setUniform('uSize', [this.params.width.value, this.params.height.value]);
    this.shader.setUniform('uFit', this._fit() ? 1 : 0);
    this.renderQuad();
    this.outputFBO.end();
  }

  _fit() {
    return Math.round(this.params.mode.value) === FIT;
  }

  // While a box is being drawn, fullscreen shows the whole input to draw it on.
  // Fit's output fills the frame with the box, so the box flashes over the input
  // too, where it was drawn.
  fullscreenFBO() {
    return this.box && (!this.flashStart || this._fit()) ? this.inputFBO : this.outputFBO;
  }

  // The fullscreen picture, letterboxed to 4:3 as ui.js draws it
  _letterbox(canvasW, canvasH) {
    let dw = canvasW;
    let dh = canvasW / (640 / 480);
    if (dh > canvasH) {
      dh = canvasH;
      dw = canvasH * (640 / 480);
    }
    return { dx: (canvasW - dw) / 2, dy: (canvasH - dh) / 2, dw, dh };
  }

  // A point on screen in frame pixels, held to the picture
  _framePos(mx, my, canvasW, canvasH) {
    const { dx, dy, dw, dh } = this._letterbox(canvasW, canvasH);
    const g = this.glCanvas;
    const u = Math.max(0, Math.min(1, (mx - dx) / dw));
    const v = Math.max(0, Math.min(1, (my - dy) / dh));
    return [u * g.width, v * g.height];
  }

  handleMouseDown(mx, my, canvasW, canvasH, button) {
    if (button !== 'left') return;
    const [x, y] = this._framePos(mx, my, canvasW, canvasH);
    this.box = { x0: x, y0: y, x1: x, y1: y };
    this.flashStart = 0;
  }

  handleMouseDrag(mx, my, canvasW, canvasH) {
    if (!this.box || this.flashStart) return;
    [this.box.x1, this.box.y1] = this._framePos(mx, my, canvasW, canvasH);
  }

  // Releasing sets the params to the box, whichever way it was drawn, and
  // flashes it. A box under a pixel wide or high is a click, and changes nothing.
  handleMouseUp() {
    if (!this.box || this.flashStart) return;
    const b = this.box;
    const x = Math.round(Math.min(b.x0, b.x1));
    const y = Math.round(Math.min(b.y0, b.y1));
    const w = Math.round(Math.max(b.x0, b.x1)) - x;
    const h = Math.round(Math.max(b.y0, b.y1)) - y;
    if (w < 1 || h < 1) {
      this.box = null;
      return;
    }
    this.setParam('x', x);
    this.setParam('y', y);
    this.setParam('width', w);
    this.setParam('height', h);
    this.box = { x0: x, y0: y, x1: x + w, y1: y + h };
    this.flashStart = performance.now();
  }

  // The white box, over the fullscreen picture at (dx, dy) and dw × dh
  drawFullscreenOverlay(p, dx, dy, dw, dh) {
    if (!this.box) return;
    if (this.flashStart) {
      const t = performance.now() - this.flashStart;
      if (t >= FLASH_MS) {
        this.box = null;
        this.flashStart = 0;
        return;
      }
      if (Math.floor(t / BLINK_MS) % 2 === 1) return;
    }
    const g = this.glCanvas;
    const b = this.box;
    const x0 = dx + Math.min(b.x0, b.x1) / g.width * dw;
    const y0 = dy + Math.min(b.y0, b.y1) / g.height * dh;
    const x1 = dx + Math.max(b.x0, b.x1) / g.width * dw;
    const y1 = dy + Math.max(b.y0, b.y1) / g.height * dh;
    p.push();
    p.noFill();
    p.stroke(255);
    p.strokeWeight(2);
    p.rect(x0, y0, x1 - x0, y1 - y0);
    p.pop();
  }
}

registerModule('Crop', CropModule);
