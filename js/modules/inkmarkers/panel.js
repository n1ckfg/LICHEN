// InkMarkers' fullscreen toolbar: the Ink Markers Studio sidebar as a DOM
// overlay, plus a current colour indicator that opens a colour wheel. Every
// control writes the module's params, and sync() reads them back each frame,
// so the dials, cables and Seed show here too. Built with createElement only,
// so the node-gles3 export's stub document can build it.

export const PALETTE = [
  '#000000', '#202020', '#404040', '#606060',
  '#808080', '#A0A0A0', '#C0C0C0', '#E0E0E0',
  '#0000FF', '#B400FC', '#FC0090', '#FC4800',
  '#FFFF00', '#48FC00', '#00FC90', '#00B4FC',
  '#FFFFFF',
];

const ACCENT = '#5a8aba';
const WHEEL = 150; // CSS px

export function hexToRgb(hex) {
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
}

export function rgbToHex(rgb) {
  return '#' + rgb.map(c => Math.round(c).toString(16).padStart(2, '0')).join('').toUpperCase();
}

// h 0..1, s 0..1, v 0..1 -> 0..255
export function hsvToRgb(h, s, v) {
  const i = Math.floor(h * 6) % 6;
  const f = h * 6 - Math.floor(h * 6);
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i];
  return [r * 255, g * 255, b * 255];
}

export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return { h, s: max > 0 ? d / max : 0, v: max };
}

function el(tag, css, text) {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (text !== undefined) e.textContent = text;
  return e;
}

const BUTTON_CSS = `
  flex: 1 1 calc(50% - 3px); padding: 6px 8px; border: 1px solid #444;
  background: #2a2a2e; color: #ccc; border-radius: 4px; cursor: pointer;
  font: 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
`;

export class InkMarkersPanel {
  constructor(mod) {
    this.mod = mod;
    this.visible = false;
    this._synced = {};
    // The wheel keeps its own hue and saturation, so they survive black and grey
    this._hsv = { h: 0, s: 0, v: 0 };
    this._wheelRgb = null;
    this._wheelDrawnV = -1;
    this._build();
  }

  _build() {
    const root = this.root = el('div', `
      position: fixed; top: 12px; left: 12px; z-index: 1000; display: none;
      width: 200px; max-height: calc(100vh - 24px); overflow-y: auto; box-sizing: border-box;
      padding: 12px; background: rgba(37, 37, 41, 0.94); border: 1px solid #333; border-radius: 6px;
      color: #e8e8e8; font: 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      user-select: none;
    `);
    // p5 binds its mouse handlers to window, so without this a click here would
    // also start a stroke under the panel
    for (const type of ['mousedown', 'click', 'dblclick', 'wheel', 'touchstart']) {
      root.addEventListener(type, e => e.stopPropagation());
    }

    const section = (title) => {
      const s = el('div', 'margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid #333;');
      s.appendChild(el('div', 'font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #888; margin-bottom: 6px;', title));
      root.appendChild(s);
      return s;
    };

    // A row of buttons for a drop-down param
    const choices = (title, param) => {
      const s = section(title);
      const group = el('div', 'display: flex; flex-wrap: wrap; gap: 6px;');
      const buttons = this.mod.params[param].valueLabels.map((label, i) => {
        const b = el('button', BUTTON_CSS, label);
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
      const input = el('input', `flex: 1; min-width: 0; accent-color: ${ACCENT};`);
      input.type = 'range';
      input.min = p.min; input.max = p.max; input.step = p.step;
      input.oninput = () => this.mod.setParam(param, parseFloat(input.value));
      const out = el('span', 'width: 34px; text-align: right; color: #888;');
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
    const colorSection = section('Color');
    const current = el('div', 'display: flex; align-items: center; gap: 8px; margin-bottom: 8px;');
    this._indicator = el('div', `
      width: 40px; height: 40px; border-radius: 6px; border: 2px solid #666; cursor: pointer;
      box-shadow: 0 0 0 1px #111 inset; flex-shrink: 0;
    `);
    this._indicator.title = 'Color wheel';
    this._indicator.onclick = () => this._toggleWheel();
    this._hexLabel = el('span', 'font: 12px monospace; color: #aaa;');
    current.appendChild(this._indicator);
    current.appendChild(this._hexLabel);
    colorSection.appendChild(current);

    this._wheelBox = el('div', 'display: none; margin-bottom: 8px;');
    this._wheel = el('canvas', `width: ${WHEEL}px; height: ${WHEEL}px; display: block; margin: 0 auto 6px; cursor: crosshair; touch-action: none;`);
    this._wheel.onpointerdown = (e) => {
      this._wheel.setPointerCapture?.(e.pointerId);
      this._pickWheel(e);
    };
    this._wheel.onpointermove = (e) => {
      if (e.buttons & 1) this._pickWheel(e);
    };
    this._value = el('input', `width: 100%; accent-color: ${ACCENT};`);
    this._value.type = 'range';
    this._value.min = 0; this._value.max = 1; this._value.step = 0.001;
    this._value.title = 'Brightness';
    this._value.oninput = () => {
      this._hsv.v = parseFloat(this._value.value);
      this._applyHsv();
    };
    this._wheelBox.appendChild(this._wheel);
    this._wheelBox.appendChild(this._value);
    colorSection.appendChild(this._wheelBox);

    const swatches = el('div', 'display: grid; grid-template-columns: repeat(6, 1fr); gap: 4px;');
    this._swatches = PALETTE.map((hex) => {
      const sw = el('div', `aspect-ratio: 1; border-radius: 4px; cursor: pointer; border: 2px solid transparent; background: ${hex};`);
      sw.onclick = () => this._setRgb(hexToRgb(hex));
      swatches.appendChild(sw);
      return sw;
    });
    colorSection.appendChild(swatches);

    // Actions
    const actions = el('div', 'display: flex; flex-wrap: wrap; gap: 6px;');
    const action = (label, fn) => {
      const b = el('button', BUTTON_CSS, label);
      b.onclick = fn;
      actions.appendChild(b);
      return b;
    };
    action('Clear', () => this.mod.fireTrigger('clear'));
    action('Save Image', () => this.mod.saveImage());
    this._seedButton = action('Seed', () => this.mod.fireTrigger('reseed'));
    this._seedButton.style.flexBasis = '100%';
    this._seedButton.style.fontFamily = 'monospace';
    root.appendChild(actions);

    this.hint = el('div', `
      position: fixed; bottom: 12px; left: 224px; z-index: 1000; display: none;
      color: #888; font: 12px monospace; pointer-events: none;
    `, 'Draw with mouse or pen · 1–4 tips · [ ] size · C clear · Ctrl+S save · ESC exit');

    document.body.appendChild(root);
    document.body.appendChild(this.hint);
  }

  show() {
    if (!this.visible) {
      this.visible = true;
      this.root.style.display = 'block';
      this.hint.style.display = 'block';
      this._synced = {};
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

    const rgb = this.mod.color255();
    const hex = rgbToHex(rgb);
    if (changed('color', hex)) {
      this._indicator.style.background = hex;
      this._hexLabel.textContent = hex;
      this._swatches.forEach((sw, i) => {
        const on = PALETTE[i] === hex;
        sw.style.borderColor = on ? '#fff' : 'transparent';
        sw.style.boxShadow = on ? '0 0 6px rgba(255, 255, 255, 0.3)' : 'none';
      });
      // Set from somewhere other than the wheel: move the wheel's marker to it
      if (!this._wheelRgb || rgbToHex(this._wheelRgb) !== hex) {
        const hsv = rgbToHsv(...rgb);
        if (hsv.v > 0) {
          if (hsv.s > 0) this._hsv.h = hsv.h;
          this._hsv.s = hsv.s;
        }
        this._hsv.v = hsv.v;
        this._wheelRgb = null;
      }
      if (this._wheelOpen()) this._drawWheel();
    }

    const seed = this.mod.seed ? `Seed ${this.mod.seed}` : 'Seed';
    if (changed('seed', seed)) this._seedButton.textContent = seed;
  }

  _highlight(buttons, index) {
    buttons.forEach((b, i) => {
      const on = i === index;
      b.style.background = on ? '#3a5a8a' : '#2a2a2e';
      b.style.borderColor = on ? ACCENT : '#444';
      b.style.color = on ? '#fff' : '#ccc';
    });
  }

  _setRgb(rgb) {
    this.mod.setParam('r', Math.round(rgb[0]));
    this.mod.setParam('g', Math.round(rgb[1]));
    this.mod.setParam('b', Math.round(rgb[2]));
  }

  _wheelOpen() {
    return this._wheelBox.style.display !== 'none';
  }

  _toggleWheel() {
    const open = !this._wheelOpen();
    this._wheelBox.style.display = open ? 'block' : 'none';
    if (open) this._drawWheel();
  }

  _applyHsv() {
    const { h, s, v } = this._hsv;
    this._wheelRgb = hsvToRgb(h, s, v).map(Math.round);
    this._setRgb(this._wheelRgb);
  }

  _pickWheel(e) {
    const rect = this._wheel.getBoundingClientRect();
    const r = rect.width / 2;
    const dx = e.clientX - rect.left - r, dy = e.clientY - rect.top - r;
    this._hsv.h = ((Math.atan2(dy, dx) / (2 * Math.PI)) + 1) % 1;
    this._hsv.s = Math.min(1, Math.hypot(dx, dy) / r);
    // Picking a hue on black would show nothing, so bring the brightness up
    if (this._hsv.v < 0.05) this._hsv.v = 1;
    this._applyHsv();
    this._drawWheel();
  }

  // Hue round the disc, saturation out from the centre, at the current
  // brightness, with a ring where the colour is
  _drawWheel() {
    const canvas = this._wheel;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
    const n = WHEEL * dpr;
    const { h, s, v } = this._hsv;
    if (canvas.width !== n || this._wheelDrawnV !== v) {
      canvas.width = n;
      canvas.height = n;
      const img = ctx.createImageData(n, n);
      const r = n / 2;
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const dx = x + 0.5 - r, dy = y + 0.5 - r;
          const d = Math.hypot(dx, dy) / r;
          const i = (y * n + x) * 4;
          if (d > 1) continue;
          const [cr, cg, cb] = hsvToRgb(((Math.atan2(dy, dx) / (2 * Math.PI)) + 1) % 1, d, v);
          img.data[i] = cr; img.data[i + 1] = cg; img.data[i + 2] = cb;
          // Smooth the rim over one pixel
          img.data[i + 3] = 255 * Math.min(1, (1 - d) * r);
        }
      }
      this._wheelImage = img;
      this._wheelDrawnV = v;
    }
    ctx.putImageData(this._wheelImage, 0, 0);
    const a = h * 2 * Math.PI, rr = s * n / 2;
    ctx.beginPath();
    ctx.arc(n / 2 + Math.cos(a) * rr, n / 2 + Math.sin(a) * rr, 5 * dpr, 0, 2 * Math.PI);
    ctx.lineWidth = 2 * dpr;
    ctx.strokeStyle = v > 0.5 ? '#000' : '#fff';
    ctx.stroke();
    this._value.value = v;
  }

  dispose() {
    this.root.remove();
    this.hint.remove();
  }
}
