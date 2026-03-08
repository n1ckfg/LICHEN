import { Module } from './Module.js';
import { passthroughFrag } from '../shaders/passthrough.js';
import { registerModule } from '../moduleRegistry.js';

export class VideoPlayerModule extends Module {
  constructor(glCanvas, id) {
    super('VideoPlayer', glCanvas, id);
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      speed: { value: 1, min: 0.1, max: 4, step: 0.1, label: 'Speed' },
    };
    this.video = null;
    this.videoReady = false;
    this.createShader(passthroughFrag);
    this.createOutputFBO();
    this._createFileInput();
  }

  _createFileInput() {
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'video/*';
    this.fileInput.style.display = 'none';
    document.body.appendChild(this.fileInput);
    this.fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) this.loadVideo(file);
    });
  }

  pickFile() {
    this.fileInput.click();
  }

  loadVideo(file) {
    if (this.video) {
      this.video.remove();
    }
    const p = this.glCanvas._pInst;
    const url = URL.createObjectURL(file);
    this.video = p.createVideo(url, () => {
      this.videoReady = true;
      this.video.loop();
      this.video.volume(0);
      this.video.speed(this.params.speed.value);
    });
    this.video.hide();
  }

  process(graph, glCanvas) {
    if (!this.video || !this.videoReady) return;
    this.video.speed(this.params.speed.value);
    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('tex0', this.video);
    this.renderQuad();
    this.outputFBO.end();
  }

  dispose() {
    if (this.video) this.video.remove();
    if (this.fileInput) this.fileInput.remove();
    super.dispose();
  }
}

registerModule('VideoPlayer', VideoPlayerModule);
