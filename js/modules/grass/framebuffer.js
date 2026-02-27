// framebuffer.js — 320x201 2bpp framebuffer with colormode compositing
// GRASS coordinates: X: -160..159, Y: -100..100 (origin at center)
// Internal buffer stores 2-bit values (0-3) per pixel.

import { applyColormode } from './colormodes.js';

export const FB_WIDTH = 320;
export const FB_HEIGHT = 201;

export class Framebuffer {
  constructor() {
    // Flat array, 1 byte per pixel (only low 2 bits used)
    this.pixels = new Uint8Array(FB_WIDTH * FB_HEIGHT);
    // Current drawing position (for LINE)
    this.cursorX = 0;
    this.cursorY = 0;
  }

  // Convert GRASS coords (-160..159, -100..100) to buffer coords (0..319, 0..200)
  toBufferX(zx) {
    return (zx + 160) | 0;
  }

  toBufferY(zy) {
    // GRASS Y: -100 is bottom, +100 is top. Buffer: 0 is top, 200 is bottom.
    return (100 - zy) | 0;
  }

  // Convert buffer coords back to GRASS coords
  toGrassX(bx) {
    return bx - 160;
  }

  toGrassY(by) {
    return 100 - by;
  }

  // Check if buffer coords are in bounds
  inBounds(bx, by) {
    return bx >= 0 && bx < FB_WIDTH && by >= 0 && by < FB_HEIGHT;
  }

  // Get pixel at GRASS coordinates (returns 2-bit value)
  getPixel(zx, zy) {
    const bx = this.toBufferX(zx);
    const by = this.toBufferY(zy);
    if (!this.inBounds(bx, by)) return 0;
    return this.pixels[by * FB_WIDTH + bx] & 3;
  }

  // Set pixel at GRASS coordinates with colormode
  setPixel(zx, zy, colormode) {
    const bx = this.toBufferX(zx);
    const by = this.toBufferY(zy);
    if (!this.inBounds(bx, by)) return;
    const idx = by * FB_WIDTH + bx;
    this.pixels[idx] = applyColormode(this.pixels[idx] & 3, colormode);
  }

  // Set pixel at buffer coordinates with colormode
  setPixelBuf(bx, by, colormode) {
    if (!this.inBounds(bx, by)) return;
    const idx = by * FB_WIDTH + bx;
    this.pixels[idx] = applyColormode(this.pixels[idx] & 3, colormode);
  }

  // Get pixel at buffer coordinates
  getPixelBuf(bx, by) {
    if (!this.inBounds(bx, by)) return 0;
    return this.pixels[by * FB_WIDTH + bx] & 3;
  }

  // Set pixel at buffer coordinates directly (no colormode, for sprite blit)
  setPixelDirect(bx, by, value) {
    if (!this.inBounds(bx, by)) return;
    this.pixels[by * FB_WIDTH + bx] = value & 3;
  }

  // Clear entire framebuffer to color 0
  clear() {
    this.pixels.fill(0);
  }

  // Draw a filled box (GRASS coords: center + half-sizes)
  box(cx, cy, halfW, halfH, colormode) {
    const x1 = this.toBufferX(cx - halfW);
    const y1 = this.toBufferY(cy + halfH);
    const x2 = this.toBufferX(cx + halfW);
    const y2 = this.toBufferY(cy - halfH);

    const minX = Math.max(0, Math.min(x1, x2));
    const maxX = Math.min(FB_WIDTH - 1, Math.max(x1, x2));
    const minY = Math.max(0, Math.min(y1, y2));
    const maxY = Math.min(FB_HEIGHT - 1, Math.max(y1, y2));

    for (let by = minY; by <= maxY; by++) {
      for (let bx = minX; bx <= maxX; bx++) {
        const idx = by * FB_WIDTH + bx;
        this.pixels[idx] = applyColormode(this.pixels[idx] & 3, colormode);
      }
    }
  }

  // Draw a single point
  point(zx, zy, colormode) {
    this.setPixel(zx, zy, colormode);
  }

  // Draw a line from current position to (zx, zy) using Bresenham's algorithm
  line(zx, zy, colormode) {
    let x0 = this.toBufferX(this.cursorX);
    let y0 = this.toBufferY(this.cursorY);
    const x1 = this.toBufferX(zx);
    const y1 = this.toBufferY(zy);

    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    while (true) {
      this.setPixelBuf(x0, y0, colormode);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }

    // Update cursor to endpoint
    this.cursorX = zx;
    this.cursorY = zy;
  }

  // Draw an ellipse (GRASS coords: center + radii)
  circle(cx, cy, rx, ry, colormode) {
    // Midpoint ellipse algorithm
    const bcx = this.toBufferX(cx);
    const bcy = this.toBufferY(cy);
    const arx = Math.abs(rx);
    const ary = Math.abs(ry) || arx; // if ry not given, use rx for circle

    if (arx === 0 && ary === 0) {
      this.setPixelBuf(bcx, bcy, colormode);
      return;
    }

    // Draw ellipse using parametric approach for simplicity
    const steps = Math.max(arx, ary) * 4 + 16;
    for (let i = 0; i <= steps; i++) {
      const angle = (i / steps) * Math.PI * 2;
      const px = bcx + Math.round(arx * Math.cos(angle));
      const py = bcy + Math.round(ary * Math.sin(angle));
      this.setPixelBuf(px, py, colormode);
    }
  }

  // Capture a region as a sprite (returns 2D array of 2-bit values)
  snap(zx, zy, halfW, halfH) {
    const x1 = this.toBufferX(zx - halfW);
    const y1 = this.toBufferY(zy + halfH);
    const x2 = this.toBufferX(zx + halfW);
    const y2 = this.toBufferY(zy - halfH);

    const minX = Math.max(0, Math.min(x1, x2));
    const maxX = Math.min(FB_WIDTH - 1, Math.max(x1, x2));
    const minY = Math.max(0, Math.min(y1, y2));
    const maxY = Math.min(FB_HEIGHT - 1, Math.max(y1, y2));

    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    const data = new Uint8Array(w * h);

    for (let by = minY; by <= maxY; by++) {
      for (let bx = minX; bx <= maxX; bx++) {
        data[(by - minY) * w + (bx - minX)] = this.pixels[by * FB_WIDTH + bx] & 3;
      }
    }

    return { data, width: w, height: h };
  }

  // Blit a sprite to the framebuffer
  display(sprite, zx, zy, displayMode) {
    const bcx = this.toBufferX(zx);
    const bcy = this.toBufferY(zy);
    // Center the sprite on the given position
    const startX = bcx - Math.floor(sprite.width / 2);
    const startY = bcy - Math.floor(sprite.height / 2);

    for (let sy = 0; sy < sprite.height; sy++) {
      for (let sx = 0; sx < sprite.width; sx++) {
        const bx = startX + sx;
        const by = startY + sy;
        if (!this.inBounds(bx, by)) continue;
        const srcPixel = sprite.data[sy * sprite.width + sx];
        const idx = by * FB_WIDTH + bx;
        // displayMode acts like colormode operation on the sprite pixel
        const operation = (displayMode >> 2) & 3;
        const existing = this.pixels[idx] & 3;
        let result;
        switch (operation) {
          case 0: result = srcPixel; break;           // PLOP
          case 1: result = (existing ^ srcPixel) & 3; break; // XOR
          case 2: result = (existing | srcPixel) & 3; break; // OR
          case 3: result = (existing & srcPixel) & 3; break; // AND
          default: result = srcPixel;
        }
        this.pixels[idx] = result;
      }
    }
  }
}
