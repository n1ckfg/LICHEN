// framebuffer.js — 320x201 2bpp framebuffer with colormode compositing
// GRASS coordinates: X: -160..159, Y: -100..100 (origin at center)
// Internal buffer stores 2-bit values (0-3) per pixel.

import { applyColormode } from './colormodes.js';

export const FB_WIDTH = 320;
export const FB_HEIGHT = 201;

// A pixel as one number, for gathering a shape's pixels in a Set. Good for
// coordinates within 32768 of the screen
export function pixelKey(bx, by) {
  return (by + 32768) * 65536 + (bx + 32768);
}

// The offsets of a round brush `size` pixels across
function roundBrush(size) {
  const lo = -Math.floor((size - 1) / 2);
  const hi = lo + size - 1;
  const c = (lo + hi) / 2;
  const r2 = (size / 2) * (size / 2);
  const out = [];
  for (let oy = lo; oy <= hi; oy++) {
    for (let ox = lo; ox <= hi; ox++) {
      if ((ox - c) ** 2 + (oy - c) ** 2 <= r2) out.push([ox, oy]);
    }
  }
  return out;
}

// The pixels of the line from (x0, y0) to (x1, y1), by Bresenham's
// algorithm, each passed to put(x, y)
function bresenham(x0, y0, x1, y1, put) {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  while (true) {
    put(x0, y0);
    if (x0 === x1 && y0 === y1) return;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
}

export class Framebuffer {
  constructor() {
    // Flat array, 1 byte per pixel (only low 2 bits used)
    this.pixels = new Uint8Array(FB_WIDTH * FB_HEIGHT);
    // Current drawing position (for LINE)
    this.cursorX = 0;
    this.cursorY = 0;
    // What the TV shows this frame (see beginFrame)
    this.shown = new Uint8Array(FB_WIDTH * FB_HEIGHT);
    this.ops = 0;
    this.lastOps = 0;
    this.beamAt = 1;
    this.beamDone = false;
    // CENTER x, y: where GRASS's (0, 0) is, from the screen's centre. Every
    // command's coordinates, and the modifiers' centres, are measured from it
    this.centerX = 0;
    this.centerY = 0;
    // Drawing modifiers (modifiers.js), in the order first set up. A dot goes
    // through the last one first
    this.modifiers = [];
    // True while DISPLAY draws a snap, which PATTERN leaves as it is
    this.drawingSnap = false;
    // PATTERN.C x, y: the buffer pixel a PATTERN's element (0, 0) is drawn
    // at. null: GRASS's (0, 0) when the PATTERN is set up
    this.patternOrigin = null;
  }

  // The UV-1's TV showed the screen memory at whatever moment the beam passed,
  // so a cursor drawn and then erased in XOR (lesson 7's DRAW, lesson 9's
  // DISP CURS twice) flickered instead of vanishing. Each frame is shown as it
  // stood after a random one of its drawing commands, or at its end, drawn
  // from the number the last frame made. A frame that draws nothing is shown
  // whole
  beginFrame() {
    this.ops = 0;
    this.beamAt = 1 + Math.floor(Math.random() * (this.lastOps + 1));
    this.beamDone = false;
  }

  endFrame() {
    if (!this.beamDone) this.shown.set(this.pixels);
    this.lastOps = this.ops;
  }

  // Count a drawing command, and catch the picture if the beam is here
  _op() {
    if (++this.ops === this.beamAt && !this.beamDone) {
      this.shown.set(this.pixels);
      this.beamDone = true;
    }
  }

  // Convert GRASS coords (-160..159, -100..100 with CENTER 0,0) to buffer
  // coords (0..319, 0..200)
  toBufferX(zx) {
    return (zx + this.centerX + 160) | 0;
  }

  toBufferY(zy) {
    // GRASS Y: -100 is bottom, +100 is top. Buffer: 0 is top, 200 is bottom.
    return (100 - zy - this.centerY) | 0;
  }

  // Convert buffer coords back to GRASS coords
  toGrassX(bx) {
    return bx - 160 - this.centerX;
  }

  toGrassY(by) {
    return 100 - by - this.centerY;
  }

  // Every pixel a drawing command writes comes here, and goes through the
  // modifiers (MIRROR, MULTI, ...) to screen memory. CLEAR doesn't, as on
  // RT/1
  plot(bx, by, colormode) {
    this.plotAt(this.modifiers.length - 1, bx, by, colormode);
  }

  // Pass a dot to the modifier at `level`, or below the last to memory
  plotAt(level, bx, by, colormode) {
    if (level >= 0) {
      this.modifiers[level].dot(this, bx, by, colormode, level - 1);
      return;
    }
    if (bx < 0 || bx >= FB_WIDTH || by < 0 || by >= FB_HEIGHT) return;
    const idx = by * FB_WIDTH + bx;
    this.pixels[idx] = applyColormode(this.pixels[idx] & 3, colormode);
  }

  // Set up a modifier, or give the one of its kind already set up its new
  // values in the place it has (RT/1's CONDINSTALL)
  setModifier(mod) {
    const i = this.modifiers.findIndex(m => m.kind === mod.kind);
    if (i >= 0) this.modifiers[i] = mod;
    else this.modifiers.push(mod);
  }

  // KILL: no modifiers
  killModifiers() {
    this.modifiers = [];
  }

  // Plot each of a set of pixels once, so a shape's own overlaps don't XOR
  // away. Keys from pixelKey()
  plotSet(keys, colormode) {
    for (const k of keys) {
      this.plot((k % 65536) - 32768, Math.floor(k / 65536) - 32768, colormode);
    }
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
    this.plot(this.toBufferX(zx), this.toBufferY(zy), colormode);
  }

  // Set pixel at buffer coordinates with colormode
  setPixelBuf(bx, by, colormode) {
    this.plot(bx, by, colormode);
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

  // Clear the whole framebuffer to a color, 0 to 3 (CLEAR n, RT/1's
  // graphclr), without the modifiers
  clear(color = 0) {
    this.pixels.fill(color & 3);
    this._op();
  }

  // The buffer rectangle of an xsize by ysize area centred on (cx, cy), as
  // BOX and SNAP take it (the lessons' XSIZE and YSIZE are whole sizes), and
  // placed as DISPLAY places a snap, so SNAP and DISPLAY at one spot line up.
  // Clipped to the screen; null if nothing is on it
  rect(cx, cy, xsize, ysize) {
    const w = Math.abs(Math.floor(xsize));
    const h = Math.abs(Math.floor(ysize));
    if (w === 0 || h === 0) return null;
    const left = this.toBufferX(cx) - Math.floor(w / 2);
    const top = this.toBufferY(cy) - Math.floor(h / 2);
    const minX = Math.max(0, left);
    const maxX = Math.min(FB_WIDTH - 1, left + w - 1);
    const minY = Math.max(0, top);
    const maxY = Math.min(FB_HEIGHT - 1, top + h - 1);
    if (minX > maxX || minY > maxY) return null;
    return { minX, maxX, minY, maxY };
  }

  // Draw a filled box (GRASS coords: center + whole sizes)
  box(cx, cy, xsize, ysize, colormode) {
    const r = this.rect(cx, cy, xsize, ysize);
    if (!r) { this._op(); return; }
    const { minX, maxX, minY, maxY } = r;

    // With no modifiers, straight to memory (the box is on the screen)
    const direct = this.modifiers.length === 0;
    for (let by = minY; by <= maxY; by++) {
      for (let bx = minX; bx <= maxX; bx++) {
        if (direct) {
          const idx = by * FB_WIDTH + bx;
          this.pixels[idx] = applyColormode(this.pixels[idx] & 3, colormode);
        } else {
          this.plot(bx, by, colormode);
        }
      }
    }
    this._op();
  }

  // Draw a single point
  point(zx, zy, colormode) {
    this.setPixel(zx, zy, colormode);
    this._op();
  }

  // Draw a line from current position to (zx, zy) using Bresenham's
  // algorithm. A thickness over 1 (RT/1's fat lines) draws it with a round
  // brush that wide, each pixel once
  line(zx, zy, colormode, thickness = 1) {
    let x0 = this.toBufferX(this.cursorX);
    let y0 = this.toBufferY(this.cursorY);
    const x1 = this.toBufferX(zx);
    const y1 = this.toBufferY(zy);

    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    const brush = thickness > 1 ? roundBrush(Math.floor(thickness)) : null;
    const keys = brush ? new Set() : null;
    while (true) {
      if (brush) {
        for (const [ox, oy] of brush) keys.add(pixelKey(x0 + ox, y0 + oy));
      } else {
        this.plot(x0, y0, colormode);
      }
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
    if (keys) this.plotSet(keys, colormode);

    // Update cursor to endpoint
    this.cursorX = zx;
    this.cursorY = zy;
    this._op();
  }

  // Draw an ellipse (GRASS coords: center + radii) by the midpoint algorithm,
  // as RT/1's stefcirc() drew circles: a closed outline, so FILL stays inside
  // it. The four quarters meet on the axes, so the pixels are gathered first
  // and each drawn once: in XOR a pixel drawn twice would vanish
  circle(cx, cy, rx, ry, colormode, fill = false) {
    const bcx = this.toBufferX(cx);
    const bcy = this.toBufferY(cy);
    const arx = Math.abs(Math.trunc(rx));
    const ary = Math.abs(Math.trunc(ry)) || arx; // if ry not given, use rx for circle

    const keys = new Set();
    const add4 = (x, y) => {
      keys.add(pixelKey(bcx + x, bcy + y));
      keys.add(pixelKey(bcx - x, bcy + y));
      keys.add(pixelKey(bcx + x, bcy - y));
      keys.add(pixelKey(bcx - x, bcy - y));
    };
    const rx2 = arx * arx;
    const ry2 = ary * ary;
    let x = 0;
    let y = ary;
    let px = 0;
    let py = 2 * rx2 * y;
    // Where the slope is under 1, step x
    let p = ry2 - rx2 * ary + 0.25 * rx2;
    while (px < py) {
      add4(x, y);
      x++;
      px += 2 * ry2;
      if (p < 0) {
        p += ry2 + px;
      } else {
        y--;
        py -= 2 * rx2;
        p += ry2 + px - py;
      }
    }
    // Then step y
    p = ry2 * (x + 0.5) * (x + 0.5) + rx2 * (y - 1) * (y - 1) - rx2 * ry2;
    while (y >= 0) {
      add4(x, y);
      y--;
      py -= 2 * rx2;
      if (p > 0) {
        p += rx2 - py;
      } else {
        x++;
        px += 2 * ry2;
        p += rx2 - py + px;
      }
    }
    if (fill) this.fillRows(keys);
    this.plotSet(keys, colormode);
    this._op();
  }

  // Add to a set of pixel keys, on each row of the screen it touches,
  // everything between its leftmost and rightmost pixel: a convex outline
  // filled in, just as far as the outline goes
  fillRows(keys) {
    const rows = new Map();
    for (const k of keys) {
      const x = (k % 65536) - 32768;
      const y = Math.floor(k / 65536) - 32768;
      const r = rows.get(y);
      if (r) { r[0] = Math.min(r[0], x); r[1] = Math.max(r[1], x); } else rows.set(y, [x, x]);
    }
    for (const [y, [a, b]] of rows) {
      if (y < 0 || y >= FB_HEIGHT) continue;
      for (let x = Math.max(0, a); x <= Math.min(FB_WIDTH - 1, b); x++) keys.add(pixelKey(x, y));
    }
  }

  // A closed shape through buffer points [[x, y], ...], each joined to the
  // next and the last to the first (RT/1's POLYGON, RBOX, ELLIPSE). Every
  // pixel is drawn once, so an XOR shape is whole. A width over 1 draws the
  // outline with a round brush that wide; fill draws the inside too, by the
  // even-odd rule, so a shape that crosses itself has holes where it would
  shape(points, colormode, fill = false, width = 1) {
    const keys = new Set();
    const n = points.length;
    if (n === 0) { this._op(); return; }
    const brush = width > 1 ? roundBrush(Math.floor(width)) : [[0, 0]];
    const put = (x, y) => { for (const [ox, oy] of brush) keys.add(pixelKey(x + ox, y + oy)); };
    for (let i = 0; i < n; i++) {
      const [x0, y0] = points[(i + n - 1) % n];
      const [x1, y1] = points[i];
      bresenham(x0, y0, x1, y1, put);
    }
    if (fill && n >= 3) {
      const ys = points.map(q => q[1]);
      const top = Math.max(0, Math.min(...ys));
      const bottom = Math.min(FB_HEIGHT - 1, Math.max(...ys));
      for (let y = top; y <= bottom; y++) {
        // Where the edges cross this row. An edge counts from its upper end
        // down to just above its lower, so a corner is crossed once
        const xs = [];
        for (let i = 0; i < n; i++) {
          const [x0, y0] = points[(i + n - 1) % n];
          const [x1, y1] = points[i];
          if ((y0 <= y && y < y1) || (y1 <= y && y < y0)) {
            xs.push(x0 + (y - y0) * (x1 - x0) / (y1 - y0));
          }
        }
        xs.sort((a, b) => a - b);
        for (let j = 0; j + 1 < xs.length; j += 2) {
          const a = Math.max(0, Math.ceil(xs[j]));
          const b = Math.min(FB_WIDTH - 1, Math.floor(xs[j + 1]));
          for (let x = a; x <= b; x++) keys.add(pixelKey(x, y));
        }
      }
    }
    this.plotSet(keys, colormode);
    this._op();
  }

  // FILL: seed fill of the area of one color around (zx, zy), joined across
  // edges (not corners), found a run at a time as RT/1's TFILL did, then
  // drawn in colormode. `pattern` keeps only lines `spacing` apart through
  // the seed: 'L' across, 'V' up and down, 'D' and 'N' diagonal, 'C' both L
  // and V. Returns -1 for a seed off the screen, as RT/1 did, else 1
  fill(zx, zy, colormode, pattern = null, spacing = 1) {
    const sx = this.toBufferX(zx);
    const sy = this.toBufferY(zy);
    if (!this.inBounds(sx, sy)) { this._op(); return -1; }
    const target = this.pixels[sy * FB_WIDTH + sx] & 3;
    const W = FB_WIDTH;
    const seen = new Uint8Array(W * FB_HEIGHT);
    const inArea = (x, y) => {
      const i = y * W + x;
      return !seen[i] && (this.pixels[i] & 3) === target;
    };
    const area = [];
    const stack = [sx, sy];
    while (stack.length) {
      const y = stack.pop();
      const x = stack.pop();
      if (!inArea(x, y)) continue;
      let l = x;
      let r = x;
      while (l > 0 && inArea(l - 1, y)) l--;
      while (r < W - 1 && inArea(r + 1, y)) r++;
      for (let i = l; i <= r; i++) {
        seen[y * W + i] = 1;
        area.push(y * W + i);
      }
      // Seed the runs above and below
      for (const ny of [y - 1, y + 1]) {
        if (ny < 0 || ny >= FB_HEIGHT) continue;
        let inRun = false;
        for (let i = l; i <= r; i++) {
          const here = inArea(i, ny);
          if (here && !inRun) stack.push(i, ny);
          inRun = here;
        }
      }
    }

    const d = Math.max(1, Math.floor(spacing) || 1);
    const on = (v) => ((v % d) + d) % d === 0;
    const keep = {
      L: (x, y) => on(y - sy),
      V: (x, y) => on(x - sx),
      D: (x, y) => on((x - sx) + (y - sy)),
      N: (x, y) => on((x - sx) - (y - sy)),
      C: (x, y) => on(y - sy) || on(x - sx),
    }[pattern] || null;
    for (const i of area) {
      const x = i % W;
      const y = (i - x) / W;
      if (!keep || keep(x, y)) this.plot(x, y, colormode);
    }
    this._op();
    return 1;
  }

  // Capture a region as a sprite (center + whole sizes, as BOX)
  snap(zx, zy, xsize, ysize) {
    const r = this.rect(zx, zy, xsize, ysize);
    if (!r) return { data: new Uint8Array(0), width: 0, height: 0 };
    const { minX, maxX, minY, maxY } = r;

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

    // Displaymodes 0-3 are the lessons' plop, XOR, OR and AND (two
    // DISPLAYMODE 1s draw and erase). 4 and up keep FakeGRASS's colormode
    // encoding, where 4, 8 and 12 are XOR, OR and AND. Each pixel of the snap
    // is drawn as that operation with its own color, through the modifiers,
    // as RT/1's DISPLAY was
    const operation = displayMode < 4 ? displayMode & 3 : (displayMode >> 2) & 3;
    this.drawingSnap = true;
    try {
      for (let sy = 0; sy < sprite.height; sy++) {
        for (let sx = 0; sx < sprite.width; sx++) {
          const srcPixel = sprite.data[sy * sprite.width + sx] & 3;
          this.plot(startX + sx, startY + sy, (operation << 2) | srcPixel);
        }
      }
    } finally {
      this.drawingSnap = false;
    }
    this._op();
  }
}
