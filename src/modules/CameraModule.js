import { Module } from './Module.js';
import { passthroughFrag } from '../shaders/passthrough.js';
import { registerModule } from '../moduleRegistry.js';

export class CameraModule extends Module {
  constructor(glCanvas, id) {
    super('Camera', glCanvas, id);
    this.outputs = [{ name: 'out', type: 'video' }];
    this.capture = null;
    this.captureReady = false;
    this.createShader(passthroughFrag);
    this.createOutputFBO();
    this._initCapture();
  }

  _initCapture() {
    try {
      const p = this.glCanvas._pInst;
      this.capture = p.createCapture(p.VIDEO, () => {
        this.captureReady = true;
      });
      this.capture.size(640, 480);
      this.capture.hide();
    } catch (e) {
      console.warn('Camera not available:', e);
    }
  }

  process(graph, glCanvas) {
    if (!this.capture || !this.captureReady) return;
    if (this.capture.loadedmetadata === false) return;
    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('tex0', this.capture);
    this.renderQuad();
    this.outputFBO.end();
  }

  dispose() {
    if (this.capture) {
      this.capture.remove();
      this.capture = null;
    }
    super.dispose();
  }
}

registerModule('Camera', CameraModule);
