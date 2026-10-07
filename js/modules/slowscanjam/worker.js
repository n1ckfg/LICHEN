// SlowscanJam's codec, off the main thread. Each message is one field's source
// picture; the worker encodes it, runs the signal through the audio effects,
// decodes it straight back, and replies with the lines that came out. Encoding
// a field takes up to ~30 ms at 1 fps, which on the main thread would stall the
// whole patch.
//
// In:  { lines, fps, width, height, srcW, pixels, fx, protect }
//        pixels: RGBA bytes, rows top first
//        fx: the effects, from EffectMenu.resolve(); protect: keep the sync clean
// Out: { meta, ycc }   meta: per line x start, x end, y, sample count;
//                      ycc: every line's normalized (Y, Cb, Cr) samples, back to back
import { SlowscanEncoder } from './encoder.js';
import { SlowscanDecoder } from './decoder.js';
import { EffectStream } from '../audiofx/EffectRack.js';

const SAMPLE_RATE = 96000;
const PULSE_LENGTH = 0.2 / 1000;

// Protected sync: the picture goes into the effects at full scale (it spans
// ±0.5, leaving the rest to the sync pulses), and comes out clamped to the
// legal range. Chroma stops short of it: the decoder reads a sync pulse where
// luma and chroma both pass half their envelope, which sags to about 0.48
// over a 40 ms line (1 fps, 50 lines), so chroma at 0.45 can never pass it.
const PICTURE_GAIN = 2;
const PICTURE_LIMIT = [0.5, 0.45];

let encoder = null;
let decoder = null;
let mask = null;
let config = '';
const effects = new EffectStream();

// The app's init(): the decoder's timing comes from the encoder's settings, so it
// locks on from the first field
function init(lines, fps, width, height) {
  const hTime = (1 / fps / lines) * 2;
  const widthSamples = hTime - (PULSE_LENGTH * 4);
  encoder = new SlowscanEncoder({ sampleRate: SAMPLE_RATE, fps, lines, pulseLength: PULSE_LENGTH });
  decoder = new SlowscanDecoder({
    sampleRate: SAMPLE_RATE,
    hFreq: 1.0 / hTime,
    vFreq: fps,
    overScan: widthSamples / hTime,
    hOffset: (PULSE_LENGTH * 1.45) / hTime,
    pulseLength: PULSE_LENGTH,
    width,
    height,
  });
  mask = null;
  effects.reset();
}

// Which of a field's n samples carry picture (1), rather than sync pulses and
// the quiet around them (0). The layout is the encoder's, in its oversampled
// units, and is the same for both fields. A sample either side of each line is
// left out, since the encoder's resampling filter blends it with the quiet.
function pictureMask(n) {
  const P = encoder.pulseLengthSamples, W = encoder.widthPixels, os = encoder.oversample;
  const m = new Uint8Array(n);
  let idx = 3 * P;                                // field sync
  for (let ln = 0; ln < Math.floor(encoder.lines / 2); ln++) {
    if (ln !== 0) idx += 3 * P;                   // line sync
    const end = Math.min(n - 1, Math.floor((idx + W) / os) - 1);
    for (let i = Math.max(0, Math.ceil(idx / os) + 1); i <= end; i++) m[i] = 1;
    idx += W + P;
  }
  return m;
}

self.onmessage = (e) => {
  const { lines, fps, width, height, srcW, pixels, fx, protect } = e.data;
  const key = `${lines} ${fps} ${width} ${height}`;
  if (key !== config) {
    config = key;
    init(lines, fps, width, height);
  }

  const signal = encoder.encodeFrame(pixels, srcW, lines);
  // With no effect on, the signal goes to the decoder untouched
  effects.apply(fx);
  if (effects.active) {
    let guard = null;
    if (protect) {
      if (!mask || mask.length !== signal.left.length) mask = pictureMask(signal.left.length);
      guard = { mask, gain: PICTURE_GAIN, limit: PICTURE_LIMIT };
    }
    effects.process(signal.left, signal.right, SAMPLE_RATE, guard);
  }
  decoder.process(signal.left, signal.right);

  // The renderer skips lines with fewer than two samples or no phase
  const out = decoder.lines;
  let n = 0, total = 0;
  for (const l of out) {
    if (l.count < 2 || l.maxPhase <= 0) continue;
    n++;
    total += l.count;
  }
  const meta = new Float32Array(n * 4);
  const ycc = new Float32Array(total * 3);
  let i = 0, o = 0;
  for (const l of out) {
    if (l.count >= 2 && l.maxPhase > 0) {
      // Phase advances linearly along a line, so samples are spaced evenly
      // between the first and last sample's x
      const dxdp = (l.x2 - l.x1) / l.maxPhase;
      meta[i * 4] = l.x1 + dxdp * l.phase[0];
      meta[i * 4 + 1] = l.x1 + dxdp * l.phase[l.count - 1];
      meta[i * 4 + 2] = l.y;
      meta[i * 4 + 3] = l.count;
      ycc.set(l.ycc.subarray(0, l.count * 3), o);
      o += l.count * 3;
      i++;
    }
    decoder.releaseLine(l);
  }
  out.length = 0;
  self.postMessage({ meta, ycc }, [meta.buffer, ycc.buffer]);
};
