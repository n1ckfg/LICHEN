import { Module } from './Module.js';
import { vertSrc } from '../shaders/vert.js';
import { chromaKeyFrag, chromaKeyPickFrag, keySpace, CHROMA_KEY_MAX } from '../shaders/chroma-key.js';
import { registerModule } from '../moduleRegistry.js';

// A pipette, drawn up from its tip at the bottom left, with a + or − beside it
function eyedropperIcon(mark) {
  const marks = { '+': 'M5 2v6M2 5h6', '−': 'M2 5h6' };
  return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 21l1-3 8.5-8.5 2 2L6 20z"/>
    <path d="M11.5 7.5l5 5"/>
    <path d="M14 10l3.6-3.6a2.1 2.1 0 1 0-3-3L11 7"/>
    ${marks[mark] ? `<path d="${marks[mark]}"/>` : ''}
  </svg>`;
}

// The toolbar's three eyedroppers
const TOOLS = [
  { name: 'select', mark: '', title: 'Eyedropper: pick the colour to remove' },
  { name: 'add', mark: '+', title: 'Eyedropper +: remove this colour too' },
  { name: 'remove', mark: '−', title: 'Eyedropper −: keep this colour' },
];

export class ChromaKeyModule extends Module {
  static uid = 'e15fdf53';

  constructor(glCanvas, id) {
    super('ChromaKey', glCanvas, id);
    this.inputs = [
      { id: '8424', name: 'fg', type: 'video' },
      { id: 'ad57', name: 'bg', type: 'video' },
    ];
    this.outputs = [{ id: 'dd73', name: 'out', type: 'video' }];
    this.params = {
      r: { id: '9032', value: 0, min: 0, max: 1, step: 0.01, label: 'R' },
      g: { id: 'f99d', value: 1, min: 0, max: 1, step: 0.01, label: 'G' },
      b: { id: '4f11', value: 0, min: 0, max: 1, step: 0.01, label: 'B' },
      tolerance: { id: '33da', value: 0.2, min: 0, max: 1, step: 0.01, label: 'Tolerance' },
      softness: { id: 'e756', value: 0.1, min: 0, max: 1, step: 0.01, label: 'Softness' },
    };
    this.createShader(chromaKeyFrag);
    this.createOutputFBO();
    this.pickShader = glCanvas.createShader(vertSrc, chromaKeyPickFrag);
    this.pickFBO = this.createFramebuffer({ width: 1, height: 1, density: 1 });

    // Colours picked with Eyedropper + (removed along with the knobs' colour)
    // and Eyedropper − (kept), as [r, g, b] in 0..1. Patches save them as the
    // node's state.
    this.adds = [];
    this.removes = [];
    this.keyBuf = new Float32Array(CHROMA_KEY_MAX * 3);
    this.keepBuf = new Float32Array(CHROMA_KEY_MAX * 3);

    this.tool = 'select';
    // Clicks wait for process(), where this frame's fg is ready to sample
    this.pendingPicks = [];

    this._createFullscreenUI();
  }

  _createFullscreenUI() {
    this._uiContainer = document.createElement('div');
    this._uiContainer.className = 'chromakey-toolbar';

    this._toolBtns = {};
    for (const tool of TOOLS) {
      const btn = document.createElement('button');
      btn.className = 'chromakey-tool';
      btn.title = tool.title;
      btn.innerHTML = eyedropperIcon(tool.mark);
      btn.onclick = () => { this.tool = tool.name; this._updateUI(); };
      this._uiContainer.appendChild(btn);
      this._toolBtns[tool.name] = btn;
    }

    this._swatchEl = document.createElement('div');
    this._swatchEl.className = 'chromakey-swatch';
    this._swatchEl.title = 'The colour to remove (R, G, B)';
    this._countEl = document.createElement('div');
    this._countEl.className = 'chromakey-count';
    this._uiContainer.appendChild(this._swatchEl);
    this._uiContainer.appendChild(this._countEl);

    // p5 binds its mouse handlers to window, so without this a click on the
    // toolbar would also reach handleMouseDown() and pick a colour under it
    for (const type of ['mousedown', 'mouseup', 'click', 'dblclick', 'wheel']) {
      this._uiContainer.addEventListener(type, e => e.stopPropagation());
    }

    this._infoEl = document.createElement('div');
    this._infoEl.className = 'chromakey-hint';
    this._infoEl.textContent = 'Click to pick the colour to remove · + removes more colours · − keeps colours · ESC to exit';

    document.body.appendChild(this._uiContainer);
    document.body.appendChild(this._infoEl);
  }

  _updateUI() {
    for (const [name, btn] of Object.entries(this._toolBtns)) {
      btn.classList.toggle('active', name === this.tool);
    }
    const rgb = this._keyColor().map(v => Math.round(v * 255));
    this._swatchEl.style.background = `rgb(${rgb.join(', ')})`;
    const counts = [];
    if (this.adds.length) counts.push(`+${this.adds.length}`);
    if (this.removes.length) counts.push(`−${this.removes.length}`);
    this._countEl.textContent = counts.join(' ');
  }

  showFullscreenUI() {
    this._updateUI();
    this._uiContainer.style.display = 'flex';
    this._infoEl.style.display = 'block';
    document.body.classList.add('chromakey-picking');
  }

  hideFullscreenUI() {
    this._uiContainer.style.display = 'none';
    this._infoEl.style.display = 'none';
    document.body.classList.remove('chromakey-picking');
  }

  _keyColor() {
    return [this.params.r.value, this.params.g.value, this.params.b.value];
  }

  // A click on the fullscreen picture, letterboxed to 4:3 as ui.js draws it
  handleMouseDown(mx, my, canvasW, canvasH, button) {
    if (button !== 'left') return;
    let dw = canvasW;
    let dh = canvasW / (640 / 480);
    if (dh > canvasH) {
      dh = canvasH;
      dw = canvasH * (640 / 480);
    }
    const u = (mx - (canvasW - dw) / 2) / dw;
    const v = (my - (canvasH - dh) / 2) / dh;
    if (u < 0 || u > 1 || v < 0 || v > 1) return;
    this.pendingPicks.push({ u, v, tool: this.tool });
  }

  // Eyedropper replaces every sample with the one picked, + adds a colour to
  // remove and − one to keep. A full list drops its oldest.
  _applyPick(tool, rgb) {
    if (tool === 'select') {
      this.setParam('r', rgb[0]);
      this.setParam('g', rgb[1]);
      this.setParam('b', rgb[2]);
      this.adds = [];
      this.removes = [];
    } else if (tool === 'add') {
      this.adds.push(rgb);
      // The knobs' colour takes the key list's first slot
      if (this.adds.length > CHROMA_KEY_MAX - 1) this.adds.shift();
    } else {
      this.removes.push(rgb);
      if (this.removes.length > CHROMA_KEY_MAX) this.removes.shift();
    }
  }

  _takePicks(fg, glCanvas) {
    for (const pick of this.pendingPicks) {
      this.pickFBO.begin();
      glCanvas.clear();
      glCanvas.shader(this.pickShader);
      this.pickShader.setUniform('tex0', fg);
      this.pickShader.setUniform('uPick', [pick.u, pick.v]);
      this.pickShader.setUniform('uStep', [1 / glCanvas.width, 1 / glCanvas.height]);
      this.renderQuad();
      this.pickFBO.end();
      // One pixel, read at once: a click's worth of waiting on the GPU
      this.pickFBO.loadPixels();
      const px = this.pickFBO.pixels;
      this._applyPick(pick.tool, [0, 1, 2].map(i => Math.round(px[i] / 255 * 1e4) / 1e4));
    }
    this.pendingPicks = [];
  }

  process(graph, glCanvas) {
    const fg = this.getInput(graph, 0);
    const bg = this.getInput(graph, 1);
    if (!fg && !bg) return;
    // With no fg there is nothing to sample, so its clicks are dropped
    if (fg) this._takePicks(fg, glCanvas);
    else this.pendingPicks = [];

    const keys = [this._keyColor(), ...this.adds];
    keys.forEach((c, i) => this.keyBuf.set(keySpace(c), i * 3));
    this.removes.forEach((c, i) => this.keepBuf.set(keySpace(c), i * 3));

    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    // A lone bg has nothing over it, so it passes through
    this.shader.setUniform('tex0', fg || bg);
    this.shader.setUniform('tex1', bg || fg);
    this.shader.setUniform('uHasBg', bg ? 1 : 0);
    this.shader.setUniform('uKeys', this.keyBuf);
    this.shader.setUniform('uKeyCount', keys.length);
    this.shader.setUniform('uKeeps', this.keepBuf);
    this.shader.setUniform('uKeepCount', this.removes.length);
    this.shader.setUniform('uTolerance', this.params.tolerance.value);
    this.shader.setUniform('uSoftness', this.params.softness.value);
    this.renderQuad();
    this.outputFBO.end();
  }

  saveState() {
    if (this.adds.length === 0 && this.removes.length === 0) return null;
    return { add: this.adds.map(c => [...c]), remove: this.removes.map(c => [...c]) };
  }

  loadState(state) {
    const colors = (list, max) => (Array.isArray(list) ? list : [])
      .filter(c => Array.isArray(c) && c.length === 3 && c.every(Number.isFinite))
      .slice(-max)
      .map(c => c.map(v => Math.min(1, Math.max(0, v))));
    this.adds = colors(state.add, CHROMA_KEY_MAX - 1);
    this.removes = colors(state.remove, CHROMA_KEY_MAX);
  }

  dispose() {
    this.hideFullscreenUI();
    this._uiContainer.remove();
    this._infoEl.remove();
    super.dispose();
  }
}

registerModule('ChromaKey', ChromaKeyModule);
