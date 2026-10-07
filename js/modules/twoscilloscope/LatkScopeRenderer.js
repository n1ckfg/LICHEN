// LatkScopeRenderer from Twoscilloscope's example-latk: the current frame of a
// Latk animation is projected to the screen, encoded as one loop of XY audio,
// run through the effect chain, and drawn back from the altered audio.
//
// The strokes are encoded here rather than by XYscope, so that every sample
// of the loop is known to belong to one stroke. The effects pass Z through
// untouched, so that still holds after them, and each stroke is drawn from
// its own samples in its own colour.
//
// project() and encode() are the example's, though project() now lives in
// latk/strokes.js as projectFrame(), shared with the Latk module. The drawing
// is not the example's: it drew with OsciMesh into a WEBGL canvas of its own, and
// with p5 lines. Here each view becomes a point stream (see latk/strokes.js),
// which the module draws in LICHEN's own GL context.
import '../../libraries/p5.twoscilloscope.js';   // a classic script: it puts its classes on window
import { projectFrame, PointStream } from '../latk/strokes.js';

const { XYTransformer, XYSoundBuffer, XYDecoder } = window;

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

    this.stream = new PointStream();
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
    this.pieces = projectFrame(latk, mvp, this.canvasW, this.canvasH);
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

  // The altered audio, as the oscilloscope beam draws it: every sample of the
  // loop, with each piece's lit run in the piece's colour. The example drew
  // one OsciMesh per colour, joining each run to the one before with a line it
  // kept dark. A dark line adds no light, so here the joins are left out.
  beamStream() {
    this.stream.count = 0;
    this.beamExposure = 1;
    const n = this.x.length;
    if (n !== this.cycleFrames) return;

    const s = this.stream.reset(n);
    const x = this.x, y = this.y;
    for (let i = 0; i < n; i++) {
      s[i * 4] = x[i];
      s[i * 4 + 1] = y[i];
      s[i * 4 + 2] = -1;
      s[i * 4 + 3] = 0;
    }
    this.stream.count = n;

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
    this.stream.reset(count);
    for (let i = 0; i < strokes.length; i++) {
      this.stream.addPolyline(strokes[i].points, this.strokePieces[i].key, strokes[i].closed, this.canvasW, this.canvasH);
    }
  }

  // The current frame of each layer through the camera, as Latk draws it. The
  // example drew each stroke whole and let the canvas cut it off; these are the
  // same strokes cut at the canvas edge, and none are left out for the loop.
  lineStream() {
    this.stream.addPieces(this.projected, this.canvasW, this.canvasH);
  }

}
