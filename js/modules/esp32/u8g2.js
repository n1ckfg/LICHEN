// The display of the Death Star Plans port: a 1-bit SSD1306 OLED as U8g2
// drives it in full-buffer mode, with a draw buffer and the buffer the panel
// shows. Only the primitives ESP32 draws strokes with are kept. The port's clip
// window, draw colour, boxes, frames and bitmaps served its animation. The
// port's display was 128 x 64; this one is any size.
export class U8g2 {
  constructor(w, h) {
    this.resize(w, h);
  }

  // A blank display of w x h pixels
  resize(w, h) {
    this.w = w;
    this.h = h;
    // Whole 32-bit words, so the two buffers can be compared four pixels at a time
    const bytes = Math.ceil(w * h / 4) * 4;
    this.buf = new Uint8Array(bytes);     // draw buffer, a byte a pixel
    this.shown = new Uint8Array(bytes);   // what the panel currently displays
    this.dirty = true;                    // shown has changed since it was last uploaded
    this.buf32 = new Uint32Array(this.buf.buffer);
    this.shown32 = new Uint32Array(this.shown.buffer);
  }

  clearBuffer() {
    this.buf.fill(0);
  }

  // The port marked the panel dirty on every send. Here a buffer the same as
  // the one showing leaves it clean, so nothing is uploaded or redrawn for it.
  sendBuffer() {
    const a = this.buf32, b = this.shown32;
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    if (i === a.length) return;
    this.shown.set(this.buf);
    this.dirty = true;
  }

  drawPixel(x, y) {
    x = Math.trunc(x); y = Math.trunc(y);
    if (x >= 0 && x < this.w && y >= 0 && y < this.h) this.buf[y * this.w + x] = 1;
  }

  // port of u8g2_DrawLine (Bresenham)
  drawLine(x1, y1, x2, y2) {
    x1 = Math.trunc(x1); y1 = Math.trunc(y1); x2 = Math.trunc(x2); y2 = Math.trunc(y2);
    let dx = Math.abs(x2 - x1), dy = Math.abs(y2 - y1), swapxy = false, t;
    if (dy > dx) { swapxy = true; t = dx; dx = dy; dy = t; t = x1; x1 = y1; y1 = t; t = x2; x2 = y2; y2 = t; }
    if (x1 > x2) { t = x1; x1 = x2; x2 = t; t = y1; y1 = y2; y2 = t; }
    let err = dx >> 1;
    const ystep = y2 > y1 ? 1 : -1;
    let y = y1;
    for (let x = x1; x <= x2; x++) {
      if (swapxy) this.drawPixel(y, x); else this.drawPixel(x, y);
      err -= dy;
      if (err < 0) { y += ystep; err += dx; }
    }
  }
}
