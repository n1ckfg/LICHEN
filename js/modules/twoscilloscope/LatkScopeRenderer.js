// LatkScopeRenderer from Twoscilloscope's example-latk: the current frame of a
// Latk animation is projected to the screen, encoded as one loop of XY audio,
// run through the effect chain, and drawn back from the altered audio.
//
// The strokes are encoded here rather than by XYscope, so that every sample
// of the loop is known to belong to one stroke. The effects pass Z through
// untouched, so that still holds after them, and each stroke is drawn from
// its own samples in its own colour.
//
// project() and encode() are the example's. Its drawing is not: the example
// drew with OsciMesh into a WEBGL canvas of its own, and with p5 lines. Here
// each view becomes a point stream (see below), which TwoscilloscopeModule
// draws in LICHEN's own GL context with one shader.
import '../../libraries/p5.twoscilloscope.js';   // a classic script: it puts its classes on window
import { OrbitCamera } from './OrbitCamera.js';

const { XYTransformer, XYSoundBuffer, XYDecoder } = window;

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

// A point stream is what the shader draws: four floats a point, x and y in
// scope units (-1..1 across the canvas, +Y up), then the colour of the segment
// from this point to the next, as 0xRRGGBB, or -1 where there is none, then 0.
export class LatkScopeRenderer {

  constructor(sampleRate = 44100) {
    // shapes -> audio -> effects -> shapes; add effects to transformer.effects
    this.transformer = new XYTransformer();

    this.loopFreq = 5;      // Hz: lower gives the drawing more samples
    this.beamSize = 3;      // beam radius, px

    this.stats = {
      pieces: 0,
      dropped: 0,    // pieces left out because the loop is too short
      samples: 0,    // per loop
      pathLength: 0, // px
      ms: 0          // projecting, encoding and transforming
    };

    this.sampleRate = sampleRate;
    this.freq = 5;
    this.cycleFrames = 8820;
    this.canvasW = 0;
    this.canvasH = 0;

    // pieces of strokes, in canvas px: { points, color, key, length, start, lit }
    // start is the first sample (blanked, on the first point), then lit samples from end to end
    this.pieces = [];
    // every piece project() found, including any encode() had to leave out
    this.projected = [];
    // one loop of the altered audio
    this.x = new Float32Array(0);
    this.y = new Float32Array(0);
    this.z = new Float32Array(0);

    this.beamExposure = 1;

    this.strokes = [];
    this.strokePieces = []; // the piece each stroke was decoded from
    this.strokesDirty = true;

    this.stream = new Float32Array(4 * 4096);
    this.streamCount = 0;
  }

  getFreq() {
    return this.freq;
  }

  // Projects, encodes and transforms the current frame of each layer, as the
  // camera sees it, onto a width x height canvas.
  update(latk, cam, width, height) {
    const start = performance.now();
    this.strokesDirty = true;
    if (width < 1 || height < 1) return;

    // The loop is a whole number of samples, so XYscope plays it back one
    // table entry per sample.
    this.cycleFrames = Math.max(2, Math.round(this.sampleRate / Math.max(0.1, this.loopFreq)));
    this.freq = this.sampleRate / this.cycleFrames;
    if (width !== this.canvasW || height !== this.canvasH || this.freq !== this.transformer.getFreq()) {
      this.transformer.setup(width, height, this.sampleRate, this.freq);
    }
    this.canvasW = width;
    this.canvasH = height;

    this.project(latk, cam.getModelViewProjectionMatrix(width, height));
    this.encode();
    this.stats.ms = performance.now() - start;
  }

  project(latk, mvp) {
    this.pieces = [];
    const w = this.canvasW, h = this.canvasH;

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
              this.pieces.push({ points: [{ x: ax, y: ay }], color, key, length: 0, start: 0, lit: 0 });
            }
            const piece = this.pieces[this.pieces.length - 1];
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

    this.projected = this.pieces;
    this.stats.pathLength = 0;
    for (const piece of this.pieces) this.stats.pathLength += piece.length;
  }

  encode() {
    const n = this.cycleFrames;
    const w = this.canvasW, h = this.canvasH;
    this.stats.samples = n;
    this.stats.dropped = 0;

    // Every piece takes a blank sample that jumps the beam to its start, and at
    // least two lit ones, for its ends. If the loop is too short for that, the
    // shortest pieces are left out.
    const maxPieces = Math.floor(n / 3);
    if (this.pieces.length > maxPieces) {
      // a stable sort, so equal lengths keep their order
      const order = this.pieces.map((piece, i) => i).sort((a, b) => this.pieces[b].length - this.pieces[a].length);
      const keep = new Uint8Array(this.pieces.length);
      for (let i = 0; i < maxPieces; i++) keep[order[i]] = 1;
      const kept = this.pieces.filter((piece, i) => keep[i] === 1);
      this.stats.dropped = this.pieces.length - kept.length;
      this.pieces = kept;
    }
    this.stats.pieces = this.pieces.length;

    // The rest of the loop is shared out by length, so the beam moves at an
    // even speed, as it does in XYscope's waveforms.
    let totalLength = 0;
    for (const piece of this.pieces) totalLength += piece.length;
    const spare = n - 3 * this.pieces.length;

    // one loop in XYscope's format: X, Y and Z interleaved, the canvas mapped
    // to -1..1 with +Y up, and Z blanking the beam between pieces
    const levels = this.transformer.decoder;
    const cycle = new Float32Array(n * 3);
    let i = 0;
    const write = (x, y, lit) => {
      cycle[i * 3] = x / w * 2 - 1;
      cycle[i * 3 + 1] = 1 - y / h * 2;
      cycle[i * 3 + 2] = lit ? levels.zMax : levels.zMin;
      i++;
    };

    let before = 0; // length of the pieces so far
    for (let k = 0; k < this.pieces.length; k++) {
      const piece = this.pieces[k];
      const pts = piece.points;
      // rounded from running totals, so the shares add up to exactly the spare samples
      const after = before + piece.length;
      let share;
      if (totalLength > 0) {
        share = Math.round(spare * after / totalLength) - Math.round(spare * before / totalLength);
      } else {
        share = Math.floor(spare * (k + 1) / this.pieces.length) - Math.floor(spare * k / this.pieces.length);
      }
      before = after;

      piece.start = i;
      piece.lit = 2 + share;
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
    while (i < n) write(w / 2, h / 2, false);

    // XYTransformer runs the effects over a few loops, so that filters and
    // echoes settle, and keeps the last one.
    const loops = Math.max(0, this.transformer.settleCycles) + 1;
    const encoded = new XYSoundBuffer(n * loops, 3, this.sampleRate);
    for (let l = 0; l < loops; l++) encoded.samples.set(cycle, l * cycle.length);
    this.transformer.transform(encoded);
    const waves = this.transformer.getProcessedWaves();
    this.x = waves.x;
    this.y = waves.y;
    this.z = waves.z;
  }

  // ---------------------------------------------------------------- point streams

  _reserve(count) {
    if (this.stream.length < count * 4) this.stream = new Float32Array(Math.max(count, this.stream.length / 2) * 4);
    this.streamCount = 0;
    return this.stream;
  }

  // A polyline in canvas px, its segments in one colour
  _addPolyline(points, key, closed) {
    const s = this.stream;
    const w = this.canvasW, h = this.canvasH;
    const total = points.length + (closed ? 1 : 0);
    for (let j = 0; j < total; j++) {
      const p = points[j % points.length];
      const o = this.streamCount++ * 4;
      s[o] = p.x / w * 2 - 1;
      s[o + 1] = 1 - p.y / h * 2;
      s[o + 2] = j < total - 1 ? key : -1;
      s[o + 3] = 0;
    }
  }

  // The altered audio, as the oscilloscope beam draws it: every sample of the
  // loop, with each piece's lit run in the piece's colour. The example drew
  // one OsciMesh per colour, joining each run to the one before with a line it
  // kept dark. A dark line adds no light, so here the joins are left out.
  beamStream() {
    this.streamCount = 0;
    this.beamExposure = 1;
    const n = this.x.length;
    if (n !== this.cycleFrames) return;

    const s = this._reserve(n);
    const x = this.x, y = this.y;
    for (let i = 0; i < n; i++) {
      s[i * 4] = x[i];
      s[i * 4 + 1] = y[i];
      s[i * 4 + 2] = -1;
      s[i * 4 + 3] = 0;
    }
    this.streamCount = n;

    // Scope units: -1..1 up the canvas, and as far across it as its shape
    // allows, so the beam stays round in any window.
    const aspect = this.canvasW / this.canvasH;
    let stepSum = 0;
    let steps = 0;
    for (const piece of this.pieces) {
      const first = piece.start + 1;
      for (let i = first; i < first + piece.lit - 1; i++) s[i * 4 + 2] = piece.key;
      for (let i = first + 1; i < first + piece.lit; i++) {
        stepSum += Math.hypot((x[i] - x[i - 1]) * aspect, y[i] - y[i - 1]);
        steps++;
      }
    }

    // A beam leaves less light on a line the faster it moves, so a longer
    // drawing or a shorter loop comes out dimmer. Scale the light by the
    // average step, so a stroke peaks at about beamIntensity either way.
    const sigma = this.beamSize / (this.canvasH / 2) / 3;
    this.beamExposure = steps > 0 ? (stepSum / steps) / (sigma * Math.sqrt(2 * Math.PI)) : 1;
  }

  decodeStrokes() {
    this.strokesDirty = false;
    this.strokes = [];
    this.strokePieces = [];
    if (this.x.length !== this.cycleFrames) return;

    const settings = this.transformer.decoder.copy();
    settings.width = this.canvasW;
    settings.height = this.canvasH;
    settings.sampleRate = this.sampleRate;
    settings.freq = this.freq;
    for (const piece of this.pieces) {
      // Each piece's samples, blank and all, decoded on their own so that
      // whatever the effects made of them keeps the piece's colour.
      const s = piece.start;
      const e = piece.start + piece.lit + 1;
      const z = this.z.length > 0 ? this.z.subarray(s, e) : null;
      for (const line of XYDecoder.decodeCycle(this.x.subarray(s, e), this.y.subarray(s, e), z, e - s, settings)) {
        this.strokes.push(line);
        this.strokePieces.push(piece);
      }
    }
  }

  // The decoded strokes, on a canvas the size of the output.
  getStrokes() {
    if (this.strokesDirty) this.decodeStrokes();
    return this.strokes;
  }

  // The altered audio decoded back into strokes.
  strokeStream() {
    const strokes = this.getStrokes();
    let count = 0;
    for (const line of strokes) count += line.points.length + 1;
    this._reserve(count);
    for (let i = 0; i < strokes.length; i++) {
      this._addPolyline(strokes[i].points, this.strokePieces[i].key, strokes[i].closed);
    }
  }

  // The current frame of each layer through the camera, as Latk draws it. The
  // example drew each stroke whole and let the canvas cut it off; these are the
  // same strokes cut at the canvas edge, and none are left out for the loop.
  lineStream() {
    let count = 0;
    for (const piece of this.projected) count += piece.points.length;
    this._reserve(count);
    for (const piece of this.projected) this._addPolyline(piece.points, piece.key, false);
  }

}
