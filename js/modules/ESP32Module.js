import { Module } from './Module.js';
import { registerModule } from '../moduleRegistry.js';
import { XYInputs, findPieces } from './latk/strokes.js';
import { U8g2 } from './esp32/u8g2.js';
import { esp32Frag } from '../shaders/esp32.js';

// The port's pace: the ESP32 takes about 30 ms to send the full buffer over a
// 400 kHz I2C bus, so that is how often the panel changes
const FRAME_MS = 30;
const MAX_DT = 100;          // ms; as the port, so a tab switch doesn't fast-forward

const COLORS = [
  [0.72, 0.88, 1.00], // cool white
  [0.30, 0.62, 1.00], // blue OLED
  [1.00, 0.72, 0.28], // amber
  [0.42, 1.00, 0.62], // green
];

// An ESP32 drawing on a 1-bit SSD1306 OLED through U8g2, from the JavaScript
// port of QtPy Death Star Plans by Okubo Heavy Industries. The port played
// that sketch's animation. Here the display draws whatever comes in on the X
// and Y control pins instead, in the form Twoscilloscope takes: one loop of XY
// audio, whose lit runs are the strokes (see latk/strokes.js). Each stroke is
// drawn with U8g2's lines, a buffer goes to the panel every 30 ms as on the
// hardware, and the port's shader draws the panel. Width and Height are the
// display's pixels: 128 x 96 unless changed, the canvas's shape, where the
// port's display was 128 x 64. The longer of the two spans the canvas, and the
// other shows its share of it.
export class ESP32Module extends Module {
  static uid = '6b72b69a';

  constructor(glCanvas, id) {
    super('ESP32', glCanvas, id);
    this.inputs = [{ id: 'eb84', name: 'x', type: 'control' }, { id: '25ec', name: 'y', type: 'control' }];
    this.outputs = [{ id: '172f', name: 'out', type: 'video' }];
    this.params = {
      width: { id: '7812', value: 128, min: 1, max: 256, step: 1, label: 'Width' },
      height: { id: '8b4e', value: 96, min: 1, max: 256, step: 1, label: 'Height' },
      color: {
        id: 'e549', value: 0, min: 0, max: COLORS.length - 1, step: 1, label: 'Color',
        widget: 'dropdown', valueLabels: ['Cool White', 'Blue', 'Amber', 'Green'],
      },
      grid: {
        id: '5675', value: 1, min: 0, max: 1, step: 1, label: 'Grid',
        widget: 'dropdown', valueLabels: ['Off', 'On'],
      },
      // Seconds of a frame-rate control input drawn at once, as Twoscilloscope's
      trail: { id: '84d1', value: 1, min: 0.1, max: 10, step: 0.1, label: 'Trail' },
    };
    this.createShader(esp32Frag);
    this.createOutputFBO();

    this.xy = new XYInputs();
    const w = this.params.width.value, h = this.params.height.value;
    this.u8g2 = new U8g2(w, h);
    // The panel's texture, a texel a display pixel, written straight from the buffer
    this.panel = this.createFramebuffer({ width: w, height: h, density: 1, textureFiltering: glCanvas.NEAREST });
    this.texData = new Uint8Array(w * h * 4);

    this.clock = 0;           // virtual ms, as the port's vclock
    this.due = 0;             // when the next buffer goes to the panel
    this.lastTime = performance.now();
    this.drawnLook = null;    // the Color and Grid the output was last drawn in
  }

  process(graph, glCanvas) {
    const now = performance.now();
    this.clock += Math.min(Math.max(now - this.lastTime, 0), MAX_DT);
    this.lastTime = now;

    // Read every frame, so a pin that brings only a value keeps a trail of 60
    // points a second, as it does in Twoscilloscope
    const input = this.xy.read(this, graph, this.params.trail.value);
    // The port's delay(): each buffer is due FRAME_MS after the last was, and
    // a stall of over 250 ms isn't caught up
    const resized = this._resize();
    if (this.clock >= this.due) {
      if (this.due < this.clock - 250) this.due = this.clock;
      this.due += FRAME_MS;
      this._page(input, glCanvas);
    } else if (resized) {
      // A display of a new size starts blank, so it is drawn at once
      this._page(input, glCanvas);
    }

    // The output is drawn only when the panel or its look changes: at most
    // once a buffer, and not at all while the same picture keeps coming in
    const look = Math.round(this.params.color.value) * 2 + Math.round(this.params.grid.value);
    if (!this.u8g2.dirty && look === this.drawnLook) return;
    if (this.u8g2.dirty) this._upload(glCanvas);
    this.drawnLook = look;
    this._drawPanel(glCanvas);
  }

  // Follow Width and Height, which a knob or a cable gives in fractions.
  // Returns whether the display changed size.
  _resize() {
    const w = Math.max(1, Math.round(this.params.width.value));
    const h = Math.max(1, Math.round(this.params.height.value));
    if (w === this.u8g2.w && h === this.u8g2.h) return false;
    this.u8g2.resize(w, h);
    this.panel.resize(w, h);
    this.texData = new Uint8Array(w * h * 4);
    return true;
  }

  // One pass of the sketch's loop: clear the buffer, draw the strokes, send it
  _page(input, glCanvas) {
    const u8g2 = this.u8g2;
    const W = u8g2.w, H = u8g2.h;
    u8g2.clearBuffer();
    if (input) {
      const { x, y } = input;
      // Scope units to display pixels. The canvas keeps its shape, centred: the
      // display's longer side spans the canvas's, and the other side is in
      // proportion, so the canvas is cut off where it runs past the display
      // and leaves a margin where it stops short.
      const cw = glCanvas.width, ch = glCanvas.height;
      const sw = W >= H ? W : H * cw / ch;
      const sh = W >= H ? W * ch / cw : H;
      const ox = (W - sw) / 2, oy = (H - sh) / 2;
      // The canvas's last column and row
      const lastX = Math.ceil(ox + sw) - 1, lastY = Math.ceil(oy + sh) - 1;
      for (const piece of findPieces(input.z, input.color, x.length)) {
        const first = piece.start + 1;
        let ax = 0, ay = 0;       // the pixel of the sample before
        let drawn = false;
        for (let i = first; i < first + piece.lit; i++) {
          // A point on the canvas's far edge belongs to its last pixel, not
          // the one past it. A pixel may be off the display, where U8g2 here
          // draws nothing, so a line to it is cut at the display's edge.
          const bx = Math.min(lastX, Math.floor(ox + (Math.min(1, Math.max(-1, x[i])) + 1) / 2 * sw));
          const by = Math.min(lastY, Math.floor(oy + (1 - Math.min(1, Math.max(-1, y[i]))) / 2 * sh));
          // A loop has many samples a display pixel, and a line between two
          // in the same pixel is that pixel, so after a stroke's first line
          // one is drawn only when a sample moves on to another
          if (i > first && (!drawn || bx !== ax || by !== ay)) {
            u8g2.drawLine(ax, ay, bx, by);
            drawn = true;
          }
          ax = bx;
          ay = by;
        }
        if (piece.lit === 1) u8g2.drawPixel(ax, ay);
      }
    }
    u8g2.sendBuffer();
  }

  // The shown buffer into the panel's texture
  _upload(glCanvas) {
    const { shown, w: W, h: H } = this.u8g2;
    const data = this.texData;
    for (let i = 0; i < W * H; i++) {
      const v = shown[i] ? 255 : 0;
      data[i * 4] = v;
      data[i * 4 + 1] = v;
      data[i * 4 + 2] = v;
      data[i * 4 + 3] = 255;
    }
    const gl = glCanvas.drawingContext;
    const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
    const prevFlip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
    const prevPremul = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.bindTexture(gl.TEXTURE_2D, this.panel.colorTexture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.bindTexture(gl.TEXTURE_2D, prevTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, prevFlip);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, prevPremul);
    this.u8g2.dirty = false;
  }

  _drawPanel(glCanvas) {
    // The largest panel of the display's shape that fits the frame, edge to
    // edge, so a display of the frame's shape fills it. The port left a small
    // margin and kept its cells to whole pixels; here a cell is whatever
    // fraction of one that takes. In px of the logical frame, so the panel is
    // the same size at any pixel density.
    const { w: W, h: H } = this.u8g2;
    const fw = glCanvas.width, fh = glCanvas.height;
    const cell = Math.min(fw / W, fh / H);
    const pw = cell * W, ph = cell * H;
    // The port placed the panel from the left and from the bottom, so its
    // margins are rounded from there
    const px = Math.round((fw - pw) / 2), py = fh - Math.round((fh - ph) / 2) - ph;

    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('uTex', this.panel);
    this.shader.setUniform('uRes', [W, H]);
    this.shader.setUniform('uFrame', [fw, fh]);
    this.shader.setUniform('uRect', [px, py, pw, ph]);
    this.shader.setUniform('uCellPx', cell * this.pixelDensity);
    this.shader.setUniform('uColor', COLORS[Math.round(this.params.color.value)]);
    this.shader.setUniform('uGrid', Math.round(this.params.grid.value));
    this.renderQuad();
    this.outputFBO.end();
  }

  dispose() {
    this.panel.remove();
    this.panel = null;
    super.dispose();
  }
}

registerModule('ESP32', ESP32Module);
