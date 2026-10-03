// SlowscanJam's codec, off the main thread. Each message is one field's source
// picture; the worker encodes it, decodes the signal straight back, and replies
// with the lines that came out. Encoding a field takes up to ~30 ms at 1 fps,
// which on the main thread would stall the whole patch.
//
// In:  { lines, fps, width, height, srcW, pixels }   pixels: RGBA bytes, rows top first
// Out: { meta, ycc }   meta: per line x start, x end, y, sample count;
//                      ycc: every line's normalized (Y, Cb, Cr) samples, back to back
import { SlowscanEncoder } from './encoder.js';
import { SlowscanDecoder } from './decoder.js';

const SAMPLE_RATE = 96000;
const PULSE_LENGTH = 0.2 / 1000;

let encoder = null;
let decoder = null;
let config = '';

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
}

self.onmessage = (e) => {
  const { lines, fps, width, height, srcW, pixels } = e.data;
  const key = `${lines} ${fps} ${width} ${height}`;
  if (key !== config) {
    config = key;
    init(lines, fps, width, height);
  }

  const signal = encoder.encodeFrame(pixels, srcW, lines);
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
