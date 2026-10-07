import { Module } from './Module.js';
import { restoreMixFrag } from '../shaders/restore.js';
import { buildHook } from './anime4k/mpvHook.js';
import { registerModule } from '../moduleRegistry.js';

// Anime4K's Restore CNNs, from the Anime4K project: small convolutional networks
// that rebuild line art blurred or softened by resampling and compression,
// without changing the frame's size. Each model is one of Anime4K's mpv shader
// files, vendored unchanged in js/shaders/anime4k/ and run by anime4k/mpvHook.js.
const MODELS = ['Restore', 'Restore Soft'];
const SIZES = ['S', 'M', 'L', 'VL', 'UL'];

// Compiled passes by shader file, shared by every Restore node. A file is only
// imported the first time a node picks it; the UL ones are 300 KB each.
const hooks = new Map();

function loadHook(glCanvas, name) {
  let passes = hooks.get(name);
  if (!passes) {
    passes = import(`../shaders/anime4k/${name}.js`).then(m => buildHook(glCanvas, m.default));
    passes.catch(() => hooks.delete(name));   // so a later pick can retry
    hooks.set(name, passes);
  }
  return passes;
}

export class RestoreModule extends Module {
  constructor(glCanvas, id) {
    super('Restore', glCanvas, id);
    this.inputs = [{ name: 'in', type: 'video' }];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      model: {
        value: 0, min: 0, max: MODELS.length - 1, step: 1, label: 'Model',
        widget: 'dropdown', valueLabels: [...MODELS],
      },
      size: {
        value: 1, min: 0, max: SIZES.length - 1, step: 1, label: 'Size',
        widget: 'dropdown', valueLabels: [...SIZES],
      },
      clamp: {
        value: 1, min: 0, max: 1, step: 1, label: 'Clamp',
        widget: 'dropdown', valueLabels: ['Off', 'On'],
      },
      mix: { value: 1, min: 0, max: 1, step: 0.01, label: 'Mix' },
    };
    this.createShader(restoreMixFrag);
    this.createOutputFBO();

    this.buffers = [];          // one half-float buffer per pass, reused by every model
    this.restorePasses = null;  // the active model's passes; null passes the input through
    this.clampPasses = null;
    this._shownFile = null;     // the file the active (or loading) model comes from
    this._loadToken = 0;        // so a slow model can't land after a newer choice

    // The networks' features are signed, so 8-bit buffers would cut off half of them
    this.hasFloat = this._detectFloat(glCanvas);
    if (this.hasFloat) {
      loadHook(glCanvas, 'Anime4K_Clamp_Highlights').then(
        passes => { this.clampPasses = passes; },
        e => console.error('Could not load Anime4K_Clamp_Highlights:', e));
    } else {
      console.warn('Restore needs half-float framebuffers, so it passes its input through');
    }
  }

  _detectFloat(glCanvas) {
    const gl = glCanvas.drawingContext;
    const webgl2 = glCanvas._renderer && glCanvas._renderer.webglVersion === 'webgl2';
    return !!(webgl2 && gl && gl.getExtension &&
      (gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float')));
  }

  // Follow the drop-downs, whether a click or a cable moved them. A model loads
  // asynchronously; the previous one stays on until it is ready.
  _syncModel() {
    const soft = Math.round(this.params.model.value) === 1 ? 'Soft_' : '';
    const name = `Anime4K_Restore_CNN_${soft}${SIZES[Math.round(this.params.size.value)]}`;
    if (name === this._shownFile) return;
    this._shownFile = name;
    const token = ++this._loadToken;
    loadHook(this.glCanvas, name).then(
      passes => { if (token === this._loadToken) this.restorePasses = passes; },
      e => console.error(`Could not load ${name}:`, e));
  }

  _buffer(i) {
    if (!this.buffers[i]) {
      const g = this.glCanvas;
      this.buffers[i] = g.createFramebuffer({ format: g.HALF_FLOAT, textureFiltering: g.NEAREST, depth: false });
    }
    return this.buffers[i];
  }

  // Run the passes in order. MAIN starts as the input; each pass writes its own
  // buffer and saves it under its SAVE name (MAIN if it has none), where later
  // passes bind it. REPLACE so p5's default blend can't fold the alpha channel,
  // which holds a feature like the others, into the colour; end() pops it back.
  _run(passes, input) {
    const g = this.glCanvas;
    const size = this.fragResolution();
    const tex = { MAIN: input };
    passes.forEach((pass, i) => {
      const fbo = this._buffer(i);
      fbo.begin();
      g.clear();
      g.blendMode(g.REPLACE);
      g.shader(pass.shader);
      for (const name of pass.binds) {
        pass.shader.setUniform(name, name === 'HOOKED' ? tex.MAIN : tex[name]);
        pass.shader.setUniform(`${name}_size`, size);
      }
      this.renderQuad();
      fbo.end();
      tex[pass.save || 'MAIN'] = fbo;
    });
    return tex.MAIN;
  }

  process(graph, glCanvas) {
    const inputFBO = this.getInput(graph, 0);
    if (!inputFBO) return;
    if (this.hasFloat) this._syncModel();

    let restored = null;
    if (this.restorePasses) {
      let passes = this.restorePasses;
      // Clamp_Highlights measures the input before the model, then pulls the
      // model's overshoot back under the input's local maximum (its PREKERNEL pass)
      if (Math.round(this.params.clamp.value) === 1 && this.clampPasses) {
        passes = [
          ...this.clampPasses.filter(p => p.hook === 'MAIN'),
          ...passes,
          ...this.clampPasses.filter(p => p.hook === 'PREKERNEL'),
        ];
      }
      restored = this._run(passes, inputFBO);
    }

    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('tex0', inputFBO);
    // uRestored always gets a real texture, the input until a model is ready
    // (see Set every sampler in ARCHITECTURE.md)
    this.shader.setUniform('uRestored', restored || inputFBO);
    this.shader.setUniform('uMix', restored ? this.params.mix.value : 0);
    this.renderQuad();
    this.outputFBO.end();
  }

  dispose() {
    for (const fbo of this.buffers) fbo.remove();
    this.buffers = [];
    this.restorePasses = null;
    this.clampPasses = null;
    this._loadToken++;
    super.dispose();
  }
}

registerModule('Restore', RestoreModule);
