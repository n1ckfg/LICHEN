// A colour picker for a module's fullscreen toolbar, shared by InkMarkers and
// WetPaint: the current colour, which opens a colour wheel with a brightness
// slider, and the palette's swatches. It works on the module's R, G and B
// params (0..255, see colorParams()): every control writes them, and sync()
// reads them back, so dials, cables and Seed show on it too. Built with
// createElement only, so the node-gles3 export's stub document can build it.

export const PALETTE = [
  '#000000', '#202020', '#404040', '#606060',
  '#808080', '#A0A0A0', '#C0C0C0', '#E0E0E0',
  '#0000FF', '#B400FC', '#FC0090', '#FC4800',
  '#FFFF00', '#48FC00', '#00FC90', '#00B4FC',
  '#FFFFFF',
];

const WHEEL = 150; // CSS px

// A module's R, G and B params, 0..255 with Seed drawing each, under the ids
// it gives them: { r, g, b } of 4-hex ids, unique within the module (see
// Patch IDs in ARCHITECTURE.md). rgb is the colour a new node starts with.
export function colorParams(ids, rgb = [0, 0, 0]) {
  const param = (key, label, value) => ({ id: ids[key], value, min: 0, max: 255, step: 1, label, random: true });
  return { r: param('r', 'R', rgb[0]), g: param('g', 'G', rgb[1]), b: param('b', 'B', rgb[2]) };
}

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

function el(tag, css, text, className) {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (text !== undefined) e.textContent = text;
  if (className) e.className = className;
  return e;
}

// A palette swatch's frame: sunken when not chosen, white with a black ring when chosen
const SWATCH_OFF = '#0e0e1a #7878a5 #7878a5 #0e0e1a';

export class ColorPalette {
  // Builds the picker into container, a toolbar section, for mod's R, G and B
  constructor(mod, container) {
    this.mod = mod;
    this._synced = null;
    // The wheel keeps its own hue and saturation, so they survive black and grey
    this._hsv = { h: 0, s: 0, v: 0 };
    this._wheelRgb = null;
    this._wheelDrawnV = -1;
    this._build(container);
  }

  rgb() {
    const { r, g, b } = this.mod.params;
    return [r.value, g.value, b.value];
  }

  _build(container) {
    const current = el('div', 'display: flex; align-items: center; gap: 8px; margin-bottom: 8px;');
    this._indicator = el('div', `
      width: 40px; height: 40px; cursor: pointer; flex-shrink: 0; box-sizing: border-box;
      border: 2px solid; border-color: #0e0e1a #7878a5 #7878a5 #0e0e1a; box-shadow: inset 1px 1px #000, inset -1px -1px #505076;
    `);
    this._indicator.title = 'Color wheel';
    this._indicator.onclick = () => this._toggleWheel();
    this._hexLabel = el('span', "font: 12px 'Lucida Console', Monaco, 'Courier New', monospace; color: #aaa;");
    current.appendChild(this._indicator);
    current.appendChild(this._hexLabel);
    container.appendChild(current);

    this._wheelBox = el('div', 'display: none; margin-bottom: 8px;');
    this._wheel = el('canvas', `width: ${WHEEL}px; height: ${WHEEL}px; display: block; margin: 0 auto 6px; cursor: crosshair; touch-action: none;`);
    this._wheel.onpointerdown = (e) => {
      this._wheel.setPointerCapture?.(e.pointerId);
      this._pickWheel(e);
    };
    this._wheel.onpointermove = (e) => {
      if (e.buttons & 1) this._pickWheel(e);
    };
    this._value = el('input', 'width: 100%;', undefined, 'retro-range');
    this._value.type = 'range';
    this._value.min = 0; this._value.max = 1; this._value.step = 0.001;
    this._value.title = 'Brightness';
    this._value.oninput = () => {
      this._hsv.v = parseFloat(this._value.value);
      this._applyHsv();
    };
    this._wheelBox.appendChild(this._wheel);
    this._wheelBox.appendChild(this._value);
    container.appendChild(this._wheelBox);

    const swatches = el('div', 'display: grid; grid-template-columns: repeat(6, 1fr); gap: 4px;');
    this._swatches = PALETTE.map((hex) => {
      const sw = el('div', `aspect-ratio: 1; cursor: pointer; box-sizing: border-box; border: 2px solid; border-color: ${SWATCH_OFF}; background: ${hex};`);
      sw.onclick = () => this._setRgb(hexToRgb(hex));
      swatches.appendChild(sw);
      return sw;
    });
    container.appendChild(swatches);
  }

  // Shows the colour again from scratch at the next sync(), as when the toolbar opens
  invalidate() {
    this._synced = null;
  }

  // Shows the colour as it is now, touching only what changed
  sync() {
    const rgb = this.rgb();
    const hex = rgbToHex(rgb);
    if (this._synced === hex) return;
    this._synced = hex;
    this._indicator.style.background = hex;
    this._hexLabel.textContent = hex;
    this._swatches.forEach((sw, i) => {
      const on = PALETTE[i] === hex;
      sw.style.borderColor = on ? '#fff' : SWATCH_OFF;
      sw.style.boxShadow = on ? 'inset 0 0 0 1px #000' : 'none';
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
}
