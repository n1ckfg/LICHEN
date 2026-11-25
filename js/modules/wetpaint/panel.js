// WetPaint's fullscreen toolbar, a DOM overlay in the manner of InkMarkers'
// (see inkmarkers/panel.js): the shared colour picker (palette/ColorPalette.js)
// and the brush's colour as it is now, the
// sim's knobs, Paint or Water for the mouse, Flow or Freeze, Autopilot, and
// Clear, Save Image and Seed. Every control writes the module's params, and
// sync() reads them back each frame, so the dials, cables and Seed show here
// too. Built with createElement only, so the node-gles3 export's stub
// document can build it.

import { ColorPalette } from '../palette/ColorPalette.js';

function el(tag, css, text, className) {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (text !== undefined) e.textContent = text;
  if (className) e.className = className;
  return e;
}

// The look comes from the retro-* classes in css/style.css
const BUTTON_CSS = 'flex: 1 1 calc(50% - 3px); padding: 6px 8px; font-size: 12px;';
const MONO = "'Lucida Console', Monaco, 'Courier New', monospace";

export class WetPaintPanel {
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
    // also paint under the panel
    for (const type of ['mousedown', 'click', 'dblclick', 'wheel', 'touchstart', 'contextmenu']) {
      root.addEventListener(type, e => e.stopPropagation());
    }

    const section = (title) => {
      const s = el('div', 'margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid #0e0e1a; box-shadow: 0 1px #505076;');
      s.appendChild(el('div', 'font-size: 10px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; color: #888; margin-bottom: 6px;', title));
      root.appendChild(s);
      return s;
    };

    // A row of buttons for a drop-down param, or for labels and a setter
    const choices = (title, labels, set) => {
      const s = section(title);
      const group = el('div', 'display: flex; flex-wrap: wrap; gap: 6px;');
      const buttons = labels.map((label, i) => {
        const b = el('button', BUTTON_CSS, label, 'retro-button');
        b.onclick = () => set(i);
        group.appendChild(b);
        return b;
      });
      s.appendChild(group);
      return { section: s, buttons };
    };
    const paramChoices = (title, param) =>
      choices(title, this.mod.params[param].valueLabels, (i) => this.mod.setParam(param, i));

    const slider = (title, param, digits = 2) => {
      const s = section(title);
      const p = this.mod.params[param];
      const row = el('div', 'display: flex; align-items: center; gap: 8px;');
      const input = el('input', 'flex: 1; min-width: 0;', undefined, 'retro-range');
      input.type = 'range';
      input.min = p.min; input.max = p.max; input.step = p.step;
      input.oninput = () => this.mod.setParam(param, parseFloat(input.value));
      const out = el('span', `width: 34px; text-align: right; color: #888; font-family: ${MONO};`);
      row.appendChild(input);
      row.appendChild(out);
      s.appendChild(row);
      return { input, out, digits };
    };

    const colorSection = section('Color');
    this._color = new ColorPalette(this.mod, colorSection);
    // The brush's colour now: it drifts toward the ink it passes over
    const current = el('div', 'display: flex; align-items: center; gap: 8px; margin-top: 8px;');
    this._swatch = el('div', `
      width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0; box-sizing: border-box;
      border: 2px solid rgba(58, 51, 42, .35);
    `);
    current.appendChild(this._swatch);
    current.appendChild(el('span', 'color: #888;', 'Brush colour'));
    colorSection.appendChild(current);

    this._brushButtons = choices('Brush', ['Paint', 'Water'], (i) => { this.mod.waterMode = i === 1; }).buttons;

    this._sliders = {
      size: slider('Size', 'size', 0),
      gravity: slider('Gravity', 'gravity'),
      swirl: slider('Swirl', 'swirl'),
      bleed: slider('Bleed', 'bleed'),
      drying: slider('Drying', 'drying'),
      vortex: slider('Vortex', 'vortex'),
    };
    this._freezeButtons = paramChoices('Motion', 'freeze').buttons;
    this._autoButtons = paramChoices('Autopilot', 'auto').buttons;

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
    this._seedButton.style.fontFamily = MONO;
    root.appendChild(actions);

    this.hint = el('div', 'left: 224px; pointer-events: none;',
      'Drag to paint · right-drag or Shift: water · hold still to pool · 1–5 the sketch\'s inks · [ ] size · F vortex · A autopilot · Space freeze · C clear · S save · ESC exit',
      'retro-hint');

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
    const highlight = (buttons, index) => buttons.forEach((b, i) => b.classList.toggle('active', i === index));

    this._color.sync();
    const water = this.mod.waterMode ? 1 : 0;
    if (changed('water', water)) highlight(this._brushButtons, water);
    const freeze = Math.round(params.freeze.value);
    if (changed('freeze', freeze)) highlight(this._freezeButtons, freeze);
    const auto = Math.round(params.auto.value);
    if (changed('auto', auto)) highlight(this._autoButtons, auto);

    for (const [name, s] of Object.entries(this._sliders)) {
      const v = params[name].value;
      if (!changed(name, v)) continue;
      s.input.value = v;
      s.out.textContent = v.toFixed(s.digits);
    }

    const css = this.mod.brushCss();
    if (changed('swatch', css)) this._swatch.style.background = css;

    const seed = this.mod.seed ? `Seed ${this.mod.seed}` : 'Seed';
    if (changed('seed', seed)) this._seedButton.textContent = seed;
  }

  dispose() {
    this.root.remove();
    this.hint.remove();
  }
}
