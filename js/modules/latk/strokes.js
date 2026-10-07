// Latk strokes on the canvas: projecting them through the camera, encoding
// them as a loop of XY audio for the Latk module's X and Y outputs, and
// packing them as a point stream for the segment shader. NAPLPS publishes its
// drawing on X and Y outputs of its own the same way (polylinePieces, XYOutputs).
import { OrbitCamera } from './OrbitCamera.js';

// Cuts the segment a-b to the canvas (Liang-Barsky). Returns null if none of
// it is inside, or [t0, t1], where the inside part starts and ends.
function clipSegment(ax, ay, bx, by, w, h) {
  const dx = bx - ax, dy = by - ay;
  const p = [-dx, dx, -dy, dy];
  const q = [ax, w - ax, ay, h - ay];
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      // parallel to this edge, so all in or all out
      if (q[i] < 0) return null;
      continue;
    }
    const t = q[i] / p[i];
    if (p[i] < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return null;
  }
  return [t0, t1];
}

// The current frame of each layer through mvp onto a w x h canvas, as pieces of
// strokes in canvas px: { points, color, key, length, start, lit }. A stroke
// breaks where it goes behind the camera, and is cut where it leaves the canvas.
// start and lit are left for Twoscilloscope's encoder. This is the project() of
// LatkScopeRenderer in Twoscilloscope's example-latk.
export function projectFrame(latk, mvp, w, h) {
  const pieces = [];

  for (const layer of latk.layers) {
    const frame = layer.frames[layer.counter];
    if (!frame) continue;

    for (const stroke of frame.strokes) {
      // 8-bit, as ofxLatk keeps them
      const color = [Math.floor(255 * stroke.color[0]), Math.floor(255 * stroke.color[1]), Math.floor(255 * stroke.color[2])];
      const key = (color[0] << 16) | (color[1] << 8) | color[2];
      let open = false; // whether the next segment continues the last piece
      let lastValid = false;
      let lastX = 0, lastY = 0;
      for (const p of stroke.points) {
        // Behind the camera or outside its depth range: break the stroke here.
        const screen = OrbitCamera.project(mvp, p.co[0], p.co[1], p.co[2], w, h);
        const t = screen.valid && lastValid ? clipSegment(lastX, lastY, screen.x, screen.y, w, h) : null;
        if (t) {
          // The canvas is the scope's canvas, and past its edges the audio
          // would clip, so cut the stroke where it leaves the canvas.
          const ax = lastX + (screen.x - lastX) * t[0], ay = lastY + (screen.y - lastY) * t[0];
          const bx = lastX + (screen.x - lastX) * t[1], by = lastY + (screen.y - lastY) * t[1];
          if (!open || t[0] > 0) {
            pieces.push({ points: [{ x: ax, y: ay }], color, key, length: 0, start: 0, lit: 0 });
          }
          const piece = pieces[pieces.length - 1];
          piece.points.push({ x: bx, y: by });
          piece.length += Math.hypot(bx - ax, by - ay);
          open = t[1] === 1;
        } else {
          open = false;
        }
        lastX = screen.x;
        lastY = screen.y;
        lastValid = screen.valid;
      }
    }
  }

  return pieces;
}

// A polyline in px of a w x h canvas, as pieces in the form projectFrame()
// gives, in one colour ([r, g, b], 8-bit), or in none (null), which leaves
// Twoscilloscope to draw it in its default white. It is cut where it leaves the
// canvas, as projectFrame() cuts strokes, and a piece of no length is left out,
// since a canvas strokes nothing there either.
export function polylinePieces(points, color, w, h) {
  const key = color ? (color[0] << 16) | (color[1] << 8) | color[2] : -1;
  const pieces = [];
  let open = false; // whether the next segment continues the last piece
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1], b = points[k];
    const t = clipSegment(a.x, a.y, b.x, b.y, w, h);
    if (!t) {
      open = false;
      continue;
    }
    const ax = a.x + (b.x - a.x) * t[0], ay = a.y + (b.y - a.y) * t[0];
    const bx = a.x + (b.x - a.x) * t[1], by = a.y + (b.y - a.y) * t[1];
    if (!open || t[0] > 0) {
      pieces.push({ points: [{ x: ax, y: ay }], color, key, length: 0, start: 0, lit: 0 });
    }
    const piece = pieces[pieces.length - 1];
    piece.points.push({ x: bx, y: by });
    piece.length += Math.hypot(bx - ax, by - ay);
    open = t[1] === 1;
  }
  return pieces.filter((piece) => piece.length > 0);
}

// XYscope's blanking levels on the Z channel
export const Z_OFF = -1;
export const Z_ON = 1;

// Pieces from projectFrame() as one loop of n samples of XY audio, as
// Twoscilloscope's example-latk encoded them: the canvas mapped to -1..1 with
// +Y up, a blank sample (Z_OFF) that jumps the beam to the start of each
// piece, then lit samples (Z_ON) at even steps along it. color carries each
// sample's piece colour (0xRRGGBB), or -1 after the last piece. Returns
// { x, y, z, color, pieces, dropped }: the pieces encoded, each with its first
// sample (start) and lit sample count (lit), and how many were left out.
export function encodeLoop(pieces, n, w, h) {
  let dropped = 0;

  // Every piece takes a blank sample that jumps the beam to its start, and at
  // least two lit ones, for its ends. If the loop is too short for that, the
  // shortest pieces are left out.
  const maxPieces = Math.floor(n / 3);
  if (pieces.length > maxPieces) {
    // a stable sort, so equal lengths keep their order
    const order = pieces.map((piece, i) => i).sort((a, b) => pieces[b].length - pieces[a].length);
    const keep = new Uint8Array(pieces.length);
    for (let i = 0; i < maxPieces; i++) keep[order[i]] = 1;
    const kept = pieces.filter((piece, i) => keep[i] === 1);
    dropped = pieces.length - kept.length;
    pieces = kept;
  }

  // The rest of the loop is shared out by length, so the beam moves at an
  // even speed, as it does in XYscope's waveforms.
  let totalLength = 0;
  for (const piece of pieces) totalLength += piece.length;
  const spare = n - 3 * pieces.length;

  const x = new Float32Array(n), y = new Float32Array(n), z = new Float32Array(n);
  const color = new Float32Array(n).fill(-1);
  let i = 0;
  let key = -1;
  const write = (px, py, lit) => {
    x[i] = px / w * 2 - 1;
    y[i] = 1 - py / h * 2;
    z[i] = lit ? Z_ON : Z_OFF;
    color[i] = key;
    i++;
  };

  let before = 0; // length of the pieces so far
  for (let k = 0; k < pieces.length; k++) {
    const piece = pieces[k];
    const pts = piece.points;
    // rounded from running totals, so the shares add up to exactly the spare samples
    const after = before + piece.length;
    let share;
    if (totalLength > 0) {
      share = Math.round(spare * after / totalLength) - Math.round(spare * before / totalLength);
    } else {
      share = Math.floor(spare * (k + 1) / pieces.length) - Math.floor(spare * k / pieces.length);
    }
    before = after;

    piece.start = i;
    piece.lit = 2 + share;
    key = piece.key;
    write(pts[0].x, pts[0].y, false);

    // lit samples at even steps along the piece, from its first point to its last
    let seg = 0;
    let segStart = 0; // length along the piece to points[seg]
    let segLength = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    for (let j = 0; j < piece.lit; j++) {
      const at = piece.length * j / (piece.lit - 1);
      while (seg + 2 < pts.length && segStart + segLength < at) {
        segStart += segLength;
        seg++;
        segLength = Math.hypot(pts[seg + 1].x - pts[seg].x, pts[seg + 1].y - pts[seg].y);
      }
      const t = segLength > 0 ? Math.min(1, Math.max(0, (at - segStart) / segLength)) : 1;
      write(pts[seg].x + (pts[seg + 1].x - pts[seg].x) * t, pts[seg].y + (pts[seg + 1].y - pts[seg].y) * t, true);
    }
  }
  // with nothing to draw, the beam rests blanked in the middle
  key = -1;
  while (i < n) write(w / 2, h / 2, false);

  return { x, y, z, color, pieces, dropped };
}

// A module's X and Y control outputs, as Latk's (see Module System in
// ARCHITECTURE.md). Each frame, publish() encodes the pieces as one loop of
// sampleRate / loopHz samples and sets it as the control signals x and y, both
// carrying the loop's blanking (z) and colours (color). With no pieces the loop
// is all blank, so the beam rests unlit in the middle. A knob cabled to X or Y
// sees where the beam is at this moment, as the loop plays at loopHz, as 0..1.
export class XYOutputs {
  constructor(sampleRate = 44100) {
    this.sampleRate = sampleRate;
    this.phase = 0;     // where the beam is in the loop
  }

  publish(mod, pieces, w, h, dt, loopHz) {
    // A whole number of samples, so XYscope plays it back one table entry per sample
    const n = Math.max(2, Math.round(this.sampleRate / Math.max(0.1, loopHz)));
    const loop = encodeLoop(pieces, n, w, h);
    const lanes = { sampleRate: this.sampleRate, z: loop.z, color: loop.color };
    mod.controlSignals.x = { samples: loop.x, ...lanes };
    mod.controlSignals.y = { samples: loop.y, ...lanes };

    this.phase = (this.phase + dt * this.sampleRate / n) % 1;
    const i = Math.floor(this.phase * n);
    mod.controlValues.x = (loop.x[i] + 1) / 2;
    mod.controlValues.y = (loop.y[i] + 1) / 2;
  }
}

// What the segment shader draws: four floats a point, x and y in scope units
// (-1..1 across the canvas, +Y up), then the colour of the segment from this
// point to the next, as 0xRRGGBB, or -1 where there is none, then 0.
export class PointStream {

  constructor() {
    this.data = new Float32Array(4 * 4096);
    this.count = 0;
  }

  // Empties the stream, with room for count points, and returns its data
  reset(count) {
    if (this.data.length < count * 4) this.data = new Float32Array(Math.max(count, this.data.length / 2) * 4);
    this.count = 0;
    return this.data;
  }

  // A polyline in px of a w x h canvas, its segments in one colour
  addPolyline(points, key, closed, w, h) {
    const s = this.data;
    const total = points.length + (closed ? 1 : 0);
    for (let j = 0; j < total; j++) {
      const p = points[j % points.length];
      const o = this.count++ * 4;
      s[o] = p.x / w * 2 - 1;
      s[o + 1] = 1 - p.y / h * 2;
      s[o + 2] = j < total - 1 ? key : -1;
      s[o + 3] = 0;
    }
  }

  // count samples of a loop from index from, already in scope units, as a
  // polyline in one colour
  addSamples(x, y, from, count, key) {
    const s = this.data;
    for (let j = 0; j < count; j++) {
      const o = this.count++ * 4;
      s[o] = x[from + j];
      s[o + 1] = y[from + j];
      s[o + 2] = j < count - 1 ? key : -1;
      s[o + 3] = 0;
    }
  }

  // Every piece from projectFrame(), as lines
  addPieces(pieces, w, h) {
    let count = 0;
    for (const piece of pieces) count += piece.points.length;
    this.reset(count);
    for (const piece of pieces) this.addPolyline(piece.points, piece.key, false, w, h);
  }

}
