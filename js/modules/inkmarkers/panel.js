// InkMarkers' fullscreen toolbar: the Ink Markers Studio sidebar as a DOM
// overlay, plus the shared colour picker (see palette/ColorPalette.js). Every
// control writes the module's params, and sync() reads them back each frame,
// so the dials, cables and Seed show here too. Built with createElement only,
// so the node-gles3 export's stub document can build it.

import { ColorPalette } from '../palette/ColorPalette.js';

function el(tag, css, text, className) {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (text !== undefined) e.textContent = text;
  if (className) e.className = className;
  return e;
}

// The look comes from the retro-* classes in css/style.css, shared with the
// node graph and the other modules' fullscreen tools
const BUTTON_CSS = 'flex: 1 1 calc(50% - 3px); padding: 6px 8px; font-size: 12px;';

export class InkMarkersPanel {
  constructor(mod) {
    this.mod = mod;
    this.visible = false;
    this._synced = {};
    this._build();
  }

  _build() {
    const root = this.root = el('div', `
      position: fixed; top: 12px; left: 12px; z-index: 1000; display: none;
      width: 200px; max-height: calc(100vh - 24px); overflow-y: auto; box-sizing: border-box;
      padding: 12px; font-size: 12px; user-select: none;
    `, undefined, 'retro-panel');
    // p5 binds its mouse handlers to window, so without this a click here would
    // also start a stroke under the panel
    for (const type of ['mousedown', 'click', 'dblclick', 'wheel', 'touchstart']) {
      root.addEventListener(type, e => e.stopPropagation());
    }

    const section = (title) => {
      // Sections part with a chiseled groove
      const s = el('div', 'margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid #0e0e1a; box-shadow: 0 1px #505076;');
      s.appendChild(el('div', 'font-size: 10px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; color: #888; margin-bottom: 6px;', title));
      root.appendChild(s);
      return s;
    };

    // A row of buttons for a drop-down param
    const choices = (title, param) => {
      const s = section(title);
      const group = el('div', 'display: flex; flex-wrap: wrap; gap: 6px;');
      const buttons = this.mod.params[param].valueLabels.map((label, i) => {
        const b = el('button', BUTTON_CSS, label, 'retro-button');
        b.onclick = () => this.mod.setParam(param, i);
        group.appendChild(b);
        return b;
      });
      s.appendChild(group);
      return buttons;
    };

    // A slider for a knob param, shown as value * scale with a suffix
    const slider = (title, param, scale = 1, suffix = '') => {
      const s = section(title);
      const p = this.mod.params[param];
      const row = el('div', 'display: flex; align-items: center; gap: 8px;');
      const input = el('input', 'flex: 1; min-width: 0;', undefined, 'retro-range');
      input.type = 'range';
      input.min = p.min; input.max = p.max; input.step = p.step;
      input.oninput = () => this.mod.setParam(param, parseFloat(input.value));
      const out = el('span', "width: 34px; text-align: right; color: #888; font-family: 'Lucida Console', Monaco, 'Courier New', monospace;");
      row.appendChild(input);
      row.appendChild(out);
      s.appendChild(row);
      return { input, out, scale, suffix };
    };

    this._tipButtons = choices('Brush Tip', 'tip');
    this._sliders = {
      size: slider('Size', 'size'),
      flow: slider('Flow', 'flow', 100, '%'),
      bleed: slider('Ink Bleed', 'bleed', 100, '%'),
    };
    this._paperButtons = choices('Paper Texture', 'paper');

    // Colour: the current colour, which opens the wheel, then the palette
    this._color = new ColorPalette(this.mod, section('Color'));

    // Actions
    const actions = el('div', 'display: flex; flex-wrap: wrap; gap: 6px;');
    const action = (label, fn) => {
      const b = el('button', BUTTON_CSS, label, 'retro-button');
      b.onclick = fn;
      actions.appendChild(b);
      return b;
    };
    action('Clear', () => this.mod.fireTrigger('clear'));
    action('Save Image', () => this.mod.saveImage());
    this._seedButton = action('Seed', () => this.mod.fireTrigger('reseed'));
    this._seedButton.style.flexBasis = '100%';
    this._seedButton.style.fontFamily = "'Lucida Console', Monaco, 'Courier New', monospace";
    root.appendChild(actions);

    this.hint = el('div', `
      left: 224px; pointer-events: none;
    `, 'Draw with mouse or pen · 1–4 tips · [ ] size · C clear · Ctrl+S save · ESC exit', 'retro-hint');

    document.body.appendChild(root);
    document.body.appendChild(this.hint);
  }

  show() {
    if (!this.visible) {
      this.visible = true;
      this.root.style.display = 'block';
      this.hint.style.display = 'block';
      this._synced = {};
      this._color.invalidate();
    }
    this.sync();
  }

  hide() {
    if (!this.visible) return;
    this.visible = false;
    this.root.style.display = 'none';
    this.hint.style.display = 'none';
  }

  // Shows the params as they are now, touching only what changed
  sync() {
    const params = this.mod.params;
    const changed = (key, value) => {
      if (this._synced[key] === value) return false;
      this._synced[key] = value;
      return true;
    };

    const tip = Math.round(params.tip.value);
    if (changed('tip', tip)) this._highlight(this._tipButtons, tip);
    const paper = Math.round(params.paper.value);
    if (changed('paper', paper)) this._highlight(this._paperButtons, paper);

    for (const [name, s] of Object.entries(this._sliders)) {
      const v = params[name].value;
      if (!changed(name, v)) continue;
      s.input.value = v;
      s.out.textContent = Math.round(v * s.scale) + s.suffix;
    }

    this._color.sync();

    const seed = this.mod.seed ? `Seed ${this.mod.seed}` : 'Seed';
    if (changed('seed', seed)) this._seedButton.textContent = seed;
  }

  _highlight(buttons, index) {
    // The chosen option stays pushed in, as a latched toolbar button
    buttons.forEach((b, i) => b.classList.toggle('active', i === index));
  }

  dispose() {
    this.root.remove();
    this.hint.remove();
  }
}
