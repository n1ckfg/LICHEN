// modifiers.js — RT/1's global drawing modifiers (RT1/BASELINE/MODIFIER.C,
// Stephan Meyers): MIRROR, MULTI, KALIEDOSCOPE, SPHERE, CORNER and PATTERN.
//
// Every pixel a drawing command writes goes through Framebuffer.plot(), and
// from there through the modifiers set up, each of which passes it on zero or
// more times, moved, to the one set up before it, and the last to screen
// memory. A modifier keeps its place in the chain when it is set up again
// with new values (RT/1's CONDINSTALL), and KILL takes them all off.
//
// RT/1 worked on dots and on horizontal runs; here everything is a dot, which
// at 320x201 is fast enough. All coordinates are buffer pixels (x right, y
// down). Overlapping copies are not merged: a mirrored pixel that lands on
// itself is XORed twice and vanishes, as it did on RT/1.
//
// Each modifier is { kind, dot(fb, x, y, cm, next) }, and passes a dot on with
// fb.plotAt(next, x, y, cm).

import { FB_WIDTH, FB_HEIGHT } from './framebuffer.js';

const TWO_PI = Math.PI * 2;

// MIRROR.X, .Y or .XY: the dot, and its reflection across the vertical line
// x = cx, the horizontal line y = cy, or both
export function mirror(mx, my, cx, cy) {
  return {
    kind: 'MIRROR',
    dot(fb, x, y, cm, next) {
      if (mx) fb.plotAt(next, 2 * cx - x, y, cm);
      if (my) fb.plotAt(next, x, 2 * cy - y, cm);
      if (mx && my) fb.plotAt(next, 2 * cx - x, 2 * cy - y, cm);
      fb.plotAt(next, x, y, cm);
    },
  };
}

// MULTI xsize, ysize: the dot repeated every xsize, ysize pixels across the
// screen. With one size 0 it repeats along the other axis only; both 0, it
// passes the dot on alone. .X flips alternate rows of tiles across x = cx,
// .Y alternate columns across y = cy, .C draws every copy but the dot itself
// in colormode centerCm, and .H adds copies half a tile over (checkerboard)
export function multi({ xsize, ysize, cx, cy, flipX, flipY, centerCm, half }) {
  const xs = Math.abs(Math.trunc(xsize));
  const ys = Math.abs(Math.trunc(ysize));
  // RT/1's MUFX and MUFY: flip on odd tiles. C's / truncates, as trunc does
  const fx = (px, cury, y) => flipX
    ? cx - (px - cx) * (((Math.trunc((cury - y) / ys) & 1) << 1) - 1) : px;
  const fy = (py, curx, x) => flipY
    ? cy - (py - cy) * (((Math.trunc((curx - x) / xs) & 1) << 1) - 1) : py;
  return {
    kind: 'MULTI',
    dot(fb, x, y, cm, next) {
      if (!xs && !ys) { fb.plotAt(next, x, y, cm); return; }
      const put = (px, py) => fb.plotAt(next, px, py,
        centerCm !== null && (px !== x || py !== y) ? centerCm : cm);
      if (!ys) {
        for (let curx = (x % xs) - xs; curx < FB_WIDTH; curx += xs) put(curx, fy(y, curx, x));
      } else if (!xs) {
        for (let cury = (y % ys) - ys; cury < FB_HEIGHT; cury += ys) put(fx(x, cury, y), cury);
      } else {
        for (let cury = (y % ys) - ys; cury < FB_HEIGHT; cury += ys) {
          for (let curx = (x % xs) - xs; curx < FB_WIDTH; curx += xs) {
            put(fx(curx, cury, y), fy(cury, curx, x));
            if (half) put(fx(curx + (xs >> 1), cury, y), fy(cury + (ys >> 1), curx, x));
          }
        }
      }
    },
  };
}

// KALIEDOSCOPE n: the dot and n-1 copies turned about (cx, cy) in equal
// steps, by the angle-addition formulas as RT/1 did. With clip (.C) only dots
// in the slice from angle `start` (radians, counterclockwise from +x) to
// start + 2pi/n are drawn, so the picture is that one slice turned
export function kaleidoscope({ n, cx, cy, clip, start }) {
  const slices = Math.max(1, Math.trunc(n));
  const step = TWO_PI / slices;
  const ks = Math.sin(step);
  const kc = Math.cos(step);
  return {
    kind: 'KALIEDOSCOPE',
    dot(fb, x, y, cm, next) {
      if (slices <= 1 || (x === cx && y === cy)) { fb.plotAt(next, x, y, cm); return; }
      // Angles as the screen shows them, y up
      const dx = x - cx;
      const dy = cy - y;
      const mag = Math.hypot(dx, dy);
      if (clip) {
        let a = (Math.atan2(dy, dx) - start) % TWO_PI;
        if (a < 0) a += TWO_PI;
        if (a === 0 || a > step) return;
      }
      let s = dy / mag;
      let c = dx / mag;
      fb.plotAt(next, x, y, cm);
      for (let i = 1; i < slices; i++) {
        const ts = s * kc + c * ks;
        const tc = c * kc - s * ks;
        s = ts;
        c = tc;
        fb.plotAt(next, cx + Math.trunc(mag * c), cy - Math.trunc(mag * s), cm);
      }
    },
  };
}

// SPHERE xc, yc, r: the screen wrapped onto a sphere of radius r about
// (cx, cy) seen from the front, so the whole screen lands in its disc. r 0
// passes dots on as they are
export function sphere(cx, cy, r) {
  return {
    kind: 'SPHERE',
    dot(fb, x, y, cm, next) {
      if (!r) { fb.plotAt(next, x, y, cm); return; }
      const theta = (x / (FB_WIDTH - 1)) * Math.PI + Math.PI;
      const phi = (y / (FB_HEIGHT - 1)) * Math.PI;
      fb.plotAt(next,
        Math.trunc(cx + r * Math.sin(phi) * Math.cos(theta)),
        Math.trunc(cy - r * Math.cos(phi)), cm);
    },
  };
}

// CORNER xsize, ysize: nothing is drawn in the xsize by ysize rectangle at the
// screen's lower right corner, which leaves an L-shaped window. RT/1 advised
// setting it up first, so it is at the end of the chain
export function corner(xsize, ysize) {
  const xs = Math.abs(Math.trunc(xsize));
  const ys = Math.abs(Math.trunc(ysize));
  return {
    kind: 'CORNER',
    dot(fb, x, y, cm, next) {
      if (x < FB_WIDTH - xs || y < FB_HEIGHT - ys) fb.plotAt(next, x, y, cm);
    },
  };
}

// PATTERN: every dot drawn in the colormode a 2D array gives for its place,
// whatever colormode it was drawn in. The array is xs by ys, element (i, j)
// is used at i pixels right and j up from (ox, oy), and it repeats from
// there across the screen. cells is a copy, taken when PATTERN was set up,
// as RT/1 took one; null passes dots on as they are. A snap DISPLAY draws is
// left alone, as RT/1 left it
export function pattern(cells, xs, ys, ox, oy) {
  const mod = (a, n) => ((a % n) + n) % n;
  return {
    kind: 'PATTERN',
    ox,
    oy,
    dot(fb, x, y, cm, next) {
      if (!cells || fb.drawingSnap) { fb.plotAt(next, x, y, cm); return; }
      const i = mod(x - this.ox, xs);
      const j = mod(this.oy - y, ys);
      fb.plotAt(next, x, y, Math.trunc(cells[i * ys + j]) & 15);
    },
  };
}
