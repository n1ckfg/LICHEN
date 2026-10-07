// Latk strokes on the canvas: projecting them through the camera, and packing
// them as a point stream for LatkModule's line shader.
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

  // Every piece from projectFrame(), as lines
  addPieces(pieces, w, h) {
    let count = 0;
    for (const piece of pieces) count += piece.points.length;
    this.reset(count);
    for (const piece of pieces) this.addPolyline(piece.points, piece.key, false, w, h);
  }

}
