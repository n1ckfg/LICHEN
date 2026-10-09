// The scope half of LatkScopeRenderer from Twoscilloscope's example-latk: one
// loop of XY audio runs through the effect chain and is drawn back from the
// altered audio. The Latk module now does the other half, projecting and
// encoding the drawing (see latk/strokes.js), and its X and Y outputs bring the
// loop here.
//
// The loop's blanking (Z) and colour lanes mark which samples belong to which
// stroke. The effects pass Z through untouched, so that still holds after
// them, and each stroke is drawn from its own samples in its own colour.
//
// The drawing is not the example's: it drew with OsciMesh into a WEBGL canvas
// of its own, and with p5 lines. Here each view becomes a point stream (see
// latk/strokes.js), which the module draws in LICHEN's own GL context.
//
// This runs in the module's worker (worker.js), so nothing here touches the
// DOM or p5.
import '../../libraries/p5.twoscilloscope.js';   // a classic script: it puts its classes on the global scope
import { PointStream, Z_OFF, Z_ON } from '../latk/strokes.js';

const { XYTransformer, XYSoundBuffer, XYDecoder } = globalThis;

// The colour of a loop that brings none: white, where the library
// Oscilloscope's default is amber (hue 50)
const DEFAULT_KEY = 0xffffff;

export class ScopeRenderer {

  constructor() {
    // shapes -> audio -> effects -> shapes; add effects to transformer.effects
    this.transformer = new XYTransformer();

    this.beamSize = 3;      // beam radius, px

    this.sampleRate = 44100;
    this.freq = 5;
    this.cycleFrames = 8820;
    this.canvasW = 0;
    this.canvasH = 0;

    // runs of lit samples, one per stroke piece: { start, lit, key }. start is
    // the blank sample before the run, or -1 if the run starts the loop.
    this.pieces = [];
    // one loop of the audio before the effects, and after
    this.input = { x: new Float32Array(0), y: new Float32Array(0) };
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

  // Runs one loop through the effects, for a width x height canvas. input is
  // { x, y, z, color, sampleRate }: x and y in -1..1, z the blanking or null
  // for none, color 0xRRGGBB a sample or null, all of the same length.
  update(input, width, height) {
    this.strokesDirty = true;
    const n = input.x.length;
    if (n < 2 || width < 1 || height < 1) {
      this.clear();
      return;
    }

    // The loop is a whole number of samples, so XYscope plays it back one
    // table entry per sample.
    this.cycleFrames = n;
    this.freq = input.sampleRate / n;
    if (width !== this.canvasW || height !== this.canvasH || this.freq !== this.transformer.getFreq() ||
        input.sampleRate !== this.sampleRate) {
      this.transformer.setup(width, height, input.sampleRate, this.freq);
    }
    this.sampleRate = input.sampleRate;
    this.canvasW = width;
    this.canvasH = height;
    this.input = input;
    this.pieces = findPieces(input.z, input.color, n);

    // one loop in XYscope's format: X, Y and Z interleaved
    const cycle = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      cycle[i * 3] = input.x[i];
      cycle[i * 3 + 1] = input.y[i];
      cycle[i * 3 + 2] = input.z ? input.z[i] : Z_ON;
    }

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

  // Nothing coming in: nothing to draw or play
  clear() {
    this.pieces = [];
    this.input = { x: new Float32Array(0), y: new Float32Array(0) };
    this.x = new Float32Array(0);
    this.y = new Float32Array(0);
    this.z = new Float32Array(0);
    this.strokes = [];
    this.strokePieces = [];
    this.strokesDirty = false;
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
      const s = Math.max(0, piece.start);
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

  // The audio before the effects: each piece's lit run as lines. From the Latk
  // module, these are its strokes, resampled at even steps along them.
  lineStream() {
    let count = 0;
    for (const piece of this.pieces) count += piece.lit;
    this.stream.reset(count);
    for (const piece of this.pieces) {
      this.stream.addSamples(this.input.x, this.input.y, piece.start + 1, piece.lit, piece.key);
    }
  }

}

// The runs of lit samples in a loop's blanking, each with the colour of its
// first sample. A loop without blanking is one run, lit from end to end.
function findPieces(z, color, n) {
  const keyAt = (i) => (color && color[i] >= 0 ? color[i] : DEFAULT_KEY);
  if (!z) return [{ start: -1, lit: n, key: keyAt(0) }];
  const isLit = (i) => z[i] > (Z_OFF + Z_ON) / 2;
  const pieces = [];
  let i = 0;
  while (i < n) {
    if (!isLit(i)) {
      i++;
      continue;
    }
    const first = i;
    while (i < n && isLit(i)) i++;
    pieces.push({ start: first - 1, lit: i - first, key: keyAt(first) });
  }
  return pieces;
}
