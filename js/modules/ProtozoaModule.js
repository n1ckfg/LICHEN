import { Module } from './Module.js';
import {
  protozoaColorFrag,
  protozoaDiffuseFrag,
  protozoaBleedFrag,
  protozoaFeedbackFrag,
  protozoaBandingFrag,
  protozoaDisplayFrag
} from '../shaders/protozoa.js';
import { registerModule } from '../moduleRegistry.js';

export class ProtozoaModule extends Module {
  constructor(glCanvas, id) {
    super('Protozoa', glCanvas, id);
    this.inputs = [];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      diffusion: { value: 0.08, min: 0, max: 0.5, step: 0.01, label: 'Diffusion' },
      bleed: { value: 0.12, min: 0, max: 0.5, step: 0.01, label: 'Bleed' },
      feedback: { value: 0.85, min: 0, max: 0.99, step: 0.01, label: 'Feedback' },
      banding: { value: 0.15, min: 0, max: 1, step: 0.01, label: 'Banding' },
      spawnRate: { value: 0.02, min: 0, max: 0.1, step: 0.005, label: 'Spawn' },
      spawnSize: { value: 0.1, min: 0.01, max: 0.3, step: 0.01, label: 'Size' }
    };

    // Create all shaders
    this.colorShader = glCanvas.createShader(this._getVertSrc(), protozoaColorFrag);
    this.diffuseShader = glCanvas.createShader(this._getVertSrc(), protozoaDiffuseFrag);
    this.bleedShader = glCanvas.createShader(this._getVertSrc(), protozoaBleedFrag);
    this.feedbackShader = glCanvas.createShader(this._getVertSrc(), protozoaFeedbackFrag);
    this.bandingShader = glCanvas.createShader(this._getVertSrc(), protozoaBandingFrag);
    this.displayShader = glCanvas.createShader(this._getVertSrc(), protozoaDisplayFrag);

    // Create four framebuffers for circular feedback loop
    this.fb1 = glCanvas.createFramebuffer();
    this.fb2 = glCanvas.createFramebuffer();
    this.fb3 = glCanvas.createFramebuffer();
    this.fb4 = glCanvas.createFramebuffer();

    // Clear all FBOs
    this._clearFBO(this.fb1, glCanvas);
    this._clearFBO(this.fb2, glCanvas);
    this._clearFBO(this.fb3, glCanvas);
    this._clearFBO(this.fb4, glCanvas);

    this.createOutputFBO();

    // Color blob tracking
    this.colorBlobs = [];
    this.maxBlobs = 50;

    this.startTime = performance.now();
  }

  _getVertSrc() {
    return `
      precision highp float;
      attribute vec3 aPosition;
      attribute vec2 aTexCoord;
      varying vec2 vTexCoord;
      void main() {
        vTexCoord = aTexCoord;
        vec4 positionVec4 = vec4(aPosition, 1.0);
        positionVec4.xy = positionVec4.xy * 2.0 - 1.0;
        gl_Position = positionVec4;
      }
    `;
  }

  _clearFBO(fbo, glCanvas) {
    fbo.begin();
    glCanvas.clear();
    fbo.end();
  }

  _addColorBlob(x, y, r, g, b, radius) {
    this.colorBlobs.push({
      x: x,
      y: y,
      r: r,
      g: g,
      b: b,
      radius: radius,
      life: 1.0
    });
    if (this.colorBlobs.length > this.maxBlobs) {
      this.colorBlobs.shift();
    }
  }

  _updateBlobs() {
    for (let i = this.colorBlobs.length - 1; i >= 0; i--) {
      this.colorBlobs[i].life -= 0.02;
      if (this.colorBlobs[i].life <= 0) {
        this.colorBlobs.splice(i, 1);
      }
    }
  }

  _autoSpawn(time) {
    const spawnRate = this.params.spawnRate.value;
    if (Math.random() < spawnRate) {
      const hue = (time * 50) % 360;
      const rgb = this._hsvToRgb(hue / 360, 0.6 + Math.random() * 0.4, 0.7 + Math.random() * 0.3);
      const size = this.params.spawnSize.value * (0.5 + Math.random());
      this._addColorBlob(
        Math.random(),
        Math.random(),
        rgb.r,
        rgb.g,
        rgb.b,
        size
      );
    }
  }

  _hsvToRgb(h, s, v) {
    let r, g, b;
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    switch (i % 6) {
      case 0: r = v; g = t; b = p; break;
      case 1: r = q; g = v; b = p; break;
      case 2: r = p; g = v; b = t; break;
      case 3: r = p; g = q; b = v; break;
      case 4: r = t; g = p; b = v; break;
      case 5: r = v; g = p; b = q; break;
    }
    return { r, g, b };
  }

  _injectColors(fb, glCanvas) {
    fb.begin();
    glCanvas.shader(this.colorShader);

    const positions = [];
    const rgbColors = [];
    const radii = [];

    for (let i = 0; i < this.maxBlobs; i++) {
      if (i < this.colorBlobs.length) {
        const c = this.colorBlobs[i];
        positions.push(c.x, c.y);
        rgbColors.push(c.r, c.g, c.b);
        radii.push(c.radius * c.life);
      } else {
        positions.push(-1, 0);
        rgbColors.push(0, 0, 0);
        radii.push(0);
      }
    }

    this.colorShader.setUniform('u_positions', positions);
    this.colorShader.setUniform('u_rgbColors', rgbColors);
    this.colorShader.setUniform('u_radii', radii);
    this.colorShader.setUniform('u_numColors', Math.min(this.colorBlobs.length, this.maxBlobs));
    this.colorShader.setUniform('u_resolution', [glCanvas.width, glCanvas.height]);

    this.renderQuad();
    fb.end();
  }

  _renderPass(source, target, shader, uniforms, glCanvas) {
    target.begin();
    glCanvas.clear();
    glCanvas.shader(shader);

    for (const key in uniforms) {
      shader.setUniform(key, uniforms[key]);
    }
    shader.setUniform('u_texture', source);

    this.renderQuad();
    target.end();
  }

  process(graph, glCanvas) {
    const time = (performance.now() - this.startTime) / 1000.0;

    // Update and auto-spawn color blobs
    this._updateBlobs();
    this._autoSpawn(time);

    // Circular feedback loop: fb1 -> fb2 -> fb3 -> fb4 -> fb1

    // Pass 1: Diffusion (fb1 -> fb2)
    this._renderPass(this.fb1, this.fb2, this.diffuseShader, {
      'u_resolution': [glCanvas.width, glCanvas.height],
      'u_time': time,
      'u_diffusionRate': this.params.diffusion.value
    }, glCanvas);

    // Pass 2: Bleed effect (fb2 -> fb3)
    this._renderPass(this.fb2, this.fb3, this.bleedShader, {
      'u_resolution': [glCanvas.width, glCanvas.height],
      'u_time': time,
      'u_bleedStrength': this.params.bleed.value
    }, glCanvas);

    // Pass 3: Feedback with ripples (fb3 -> fb4)
    this._renderPass(this.fb3, this.fb4, this.feedbackShader, {
      'u_resolution': [glCanvas.width, glCanvas.height],
      'u_time': time,
      'u_feedback': this.params.feedback.value
    }, glCanvas);

    // Pass 4: Inject colors and apply banding (fb4 -> fb1)
    this._injectColors(this.fb1, glCanvas);
    this._renderPass(this.fb4, this.fb1, this.bandingShader, {
      'u_resolution': [glCanvas.width, glCanvas.height],
      'u_time': time,
      'u_bandingStrength': this.params.banding.value
    }, glCanvas);

    // Final display pass to outputFBO
    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.displayShader);
    this.displayShader.setUniform('u_resolution', [glCanvas.width, glCanvas.height]);
    this.displayShader.setUniform('u_time', time);
    this.displayShader.setUniform('u_texture', this.fb2);
    this.displayShader.setUniform('u_previousTexture', this.fb4);
    this.renderQuad();
    this.outputFBO.end();
  }

  dispose() {
    this.fb1 = null;
    this.fb2 = null;
    this.fb3 = null;
    this.fb4 = null;
    this.colorShader = null;
    this.diffuseShader = null;
    this.bleedShader = null;
    this.feedbackShader = null;
    this.bandingShader = null;
    this.displayShader = null;
    super.dispose();
  }
}

registerModule('Protozoa', ProtozoaModule);
