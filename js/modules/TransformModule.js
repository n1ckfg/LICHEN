import { Module } from './Module.js';
import { transformFrag } from '../shaders/transform.js';
import { letterbox } from '../frame.js';
import { registerModule } from '../moduleRegistry.js';

const SCALE_PER_WHEEL = 1.001;   // scale factor per unit of wheel delta

export class TransformModule extends Module {
  static uid = '68fcbc90';

  constructor(glCanvas, id) {
    super('Transform', glCanvas, id);
    this.inputs = [{ id: 'db89', name: 'in', type: 'video' }];
    this.outputs = [{ id: 'ea91', name: 'out', type: 'video' }];
    this.params = {
      // In frame pixels, up to a frame's width or height either way
      x: { id: '41a3', value: 0, min: -glCanvas.width, max: glCanvas.width, step: 1, label: 'X' },
      y: { id: 'eb04', value: 0, min: -glCanvas.height, max: glCanvas.height, step: 1, label: 'Y' },
      rotation: { id: '2d7a', value: 0, min: -180, max: 180, step: 0.1, label: 'Rotation' },
      scaleX: { id: '3d47', value: 1, min: -4, max: 4, step: 0.01, label: 'Scale X' },
      scaleY: { id: '3adf', value: 1, min: -4, max: 4, step: 0.01, label: 'Scale Y' },
    };
    this.dragX = null;
    this.dragY = null;
    this.createShader(transformFrag);
    this.createOutputFBO();
  }

  process(graph, glCanvas) {
    const inputFBO = this.getInput(graph, 0);
    if (!inputFBO) return;

    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('tex0', inputFBO);
    this.shader.setUniform('uResolution', [glCanvas.width, glCanvas.height]);
    this.shader.setUniform('uOffset', [this.params.x.value, this.params.y.value]);
    this.shader.setUniform('uRotation', this.params.rotation.value);
    this.shader.setUniform('uScale', [this.params.scaleX.value, this.params.scaleY.value]);
    this.renderQuad();
    this.outputFBO.end();
  }

  // The fullscreen picture, letterboxed to the frame's shape as ui.js draws it
  _letterbox(canvasW, canvasH) {
    return letterbox(this.glCanvas.width, this.glCanvas.height, canvasW, canvasH);
  }

  frameResized(w, h) {
    [this.params.x.min, this.params.x.max] = [-w, w];
    [this.params.y.min, this.params.y.max] = [-h, h];
  }

  handleMouseDown(mx, my, canvasW, canvasH, button) {
    if (button !== 'left') return;
    this.dragX = mx;
    this.dragY = my;
  }

  // A drag moves the picture with the pointer. An Alt-drag turns it about its
  // centre by the angle the pointer sweeps around it.
  handleMouseDrag(mx, my, canvasW, canvasH, alt) {
    if (this.dragX === null) return;
    const { dx, dy, dw, dh } = this._letterbox(canvasW, canvasH);
    const g = this.glCanvas;
    const kx = g.width / dw;
    const ky = g.height / dh;
    if (alt) {
      const cx = dx + (g.width / 2 + this.params.x.value) / kx;
      const cy = dy + (g.height / 2 + this.params.y.value) / ky;
      const from = Math.atan2(this.dragY - cy, this.dragX - cx);
      const to = Math.atan2(my - cy, mx - cx);
      this.setParam('rotation', wrapDegrees(this.params.rotation.value + (to - from) * 180 / Math.PI));
    } else {
      this.setParam('x', this.params.x.value + (mx - this.dragX) * kx);
      this.setParam('y', this.params.y.value + (my - this.dragY) * ky);
    }
    this.dragX = mx;
    this.dragY = my;
  }

  handleMouseUp() {
    this.dragX = null;
    this.dragY = null;
  }

  // The wheel scales both axes by the same factor, keeping their ratio
  handleWheel(delta) {
    const k = Math.pow(SCALE_PER_WHEEL, -delta);
    this.setParam('scaleX', this.params.scaleX.value * k);
    this.setParam('scaleY', this.params.scaleY.value * k);
  }
}

function wrapDegrees(deg) {
  return ((deg + 180) % 360 + 360) % 360 - 180;
}

registerModule('Transform', TransformModule);
