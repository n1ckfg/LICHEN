// SlowscanEncoder from the SlowscanJam project (index.html): turns one field of
// a picture into the stereo Cassette Video signal, luma on the left channel and
// chroma (Cb and Cr on alternating lines) on the right, with sync pulses
// marking the field and every line. This is the project's CPU path, unchanged
// apart from what it no longer needs here: the WebGL2 encoder (a second WebGL
// context per node) and `encodeCanvas()`, which read pixels from a 2D canvas.
// The signal is never played; the decoder reads it straight back.
//
// Preallocates typed-array scratch buffers so encodeFrame does zero heap
// allocations and writes via indexed assignment instead of push/spread.
export class SlowscanEncoder {
  constructor(config = {}) {
    this.sampleRate = config.sampleRate || 96000;
    this.fps = config.fps || 3.0;
    this.lines = config.lines || 150;
    this.pulseLength = config.pulseLength || 0.2 / 1000;
    this.oversample = config.oversample || 10;

    this.hTime = (1 / this.fps / this.lines) * 2;
    this.widthSamples = (this.hTime - (this.pulseLength * 4)) * this.sampleRate;
    this.widthPixels = Math.round(this.widthSamples * this.oversample);
    this.pulseLengthSamples = Math.round(this.pulseLength * this.sampleRate * this.oversample);

    this.field = 0;

    // Precompute polyphase lowpass filter (same shape as original resamplePoly).
    const factor = this.oversample;
    const taps = factor * 4 + 1;
    this.filterTaps = taps;
    this.filterHalf = (taps - 1) / 2;
    this.filter = new Float32Array(taps);
    let fsum = 0;
    for (let i = 0; i < taps; i++) {
      const n = i - this.filterHalf;
      let v = n === 0 ? 1.0 : Math.sin(Math.PI * n / factor) / (Math.PI * n);
      v *= 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (taps - 1));
      this.filter[i] = v;
      fsum += v;
    }
    for (let i = 0; i < taps; i++) this.filter[i] /= fsum;

    const P = this.pulseLengthSamples;
    const W = this.widthPixels;
    const halfLines = Math.floor(this.lines / 2);
    // Field sync = 3P (2P pulses + P quiet). Every line = W + P quiet.
    // Lines 1..halfLines-1 get a 3P sync prefix before the line data.
    this.oversampledSize = 3 * P + halfLines * (W + P) + (halfLines - 1) * 3 * P;

    this.leftOS = new Float32Array(this.oversampledSize);
    this.rightOS = new Float32Array(this.oversampledSize);

    this.outSize = Math.ceil(this.oversampledSize / factor);
    this.outLeft = new Float32Array(this.outSize);
    this.outRight = new Float32Array(this.outSize);
  }

  // frameData is RGBA bytes, rows top to bottom, as getImageData returns them
  encodeFrame(frameData, width, height) {
    const P = this.pulseLengthSamples;
    const W = this.widthPixels;
    const halfLines = Math.floor(this.lines / 2);
    const srcHeight = Math.min(height, this.lines);
    const srcWidth = Math.min(width, W);

    const L = this.leftOS, R = this.rightOS;
    let idx = 0;

    // Field sync
    if (this.field === 0) {
      for (let i = 0; i < P; i++) { L[idx] = -1; R[idx] = 1; idx++; }
      for (let i = 0; i < P; i++) { L[idx] = 1; R[idx] = -1; idx++; }
    } else {
      for (let i = 0; i < P; i++) { L[idx] = 1; R[idx] = -1; idx++; }
      for (let i = 0; i < P; i++) { L[idx] = -1; R[idx] = 1; idx++; }
    }
    for (let i = 0; i < P; i++) { L[idx] = 0; R[idx] = 0; idx++; }

    for (let ln = 0; ln < halfLines; ln++) {
      if (ln !== 0) {
        if ((ln & 1) === 0) {
          for (let i = 0; i < P; i++) { L[idx] = 1; R[idx] = 1; idx++; }
          for (let i = 0; i < P; i++) { L[idx] = -1; R[idx] = -1; idx++; }
        } else {
          for (let i = 0; i < P; i++) { L[idx] = -1; R[idx] = -1; idx++; }
          for (let i = 0; i < P; i++) { L[idx] = 1; R[idx] = 1; idx++; }
        }
        for (let i = 0; i < P; i++) { L[idx] = 0; R[idx] = 0; idx++; }
      }

      const row = ln * 2 + this.field;
      const srcRow = Math.floor((row / this.lines) * (srcHeight - 1));
      const rowBase = srcRow * srcWidth * 4;
      const useCb = (ln & 1) === 0;

      for (let x = 0; x < W; x++) {
        const srcX = ((x * (srcWidth - 1)) / W) | 0;
        const sIdx = rowBase + srcX * 4;
        const r = frameData[sIdx];
        const g = frameData[sIdx + 1];
        const b = frameData[sIdx + 2];
        const y = 0.299 * r + 0.587 * g + 0.114 * b;
        const c = useCb
          ? (-0.168736 * r - 0.331264 * g + 0.5 * b + 128)
          : (0.5 * r - 0.418688 * g - 0.081312 * b + 128);
        L[idx] = y * (1 / 255) - 0.5;
        R[idx] = c * (1 / 255) - 0.5;
        idx++;
      }
      for (let i = 0; i < P; i++) { L[idx] = 0; R[idx] = 0; idx++; }
    }

    // idx === oversampledSize at this point; downsample.
    this.resampleInto(L, idx, this.outLeft);
    this.resampleInto(R, idx, this.outRight);

    this.field = 1 - this.field;
    const outLen = Math.ceil(idx / this.oversample);
    return {
      left: this.outLeft.subarray(0, outLen),
      right: this.outRight.subarray(0, outLen)
    };
  }

  resampleInto(src, srcLen, out) {
    const factor = this.oversample;
    const taps = this.filterTaps;
    const filter = this.filter;
    const halfTaps = this.filterHalf;
    const outLen = Math.ceil(srcLen / factor);

    for (let i = 0; i < outLen; i++) {
      let val = 0;
      const center = i * factor;
      const base = center - halfTaps;
      const hi = base + taps;
      if (base >= 0 && hi <= srcLen) {
        // Fast path: no edge mirroring needed.
        for (let j = 0; j < taps; j++) val += src[base + j] * filter[j];
      } else {
        for (let j = 0; j < taps; j++) {
          let sIdx = base + j;
          if (sIdx < 0) sIdx = Math.min(-sIdx, srcLen - 1);
          else if (sIdx >= srcLen) sIdx = Math.max(0, 2 * srcLen - 2 - sIdx);
          val += src[sIdx] * filter[j];
        }
      }
      out[i] = val;
    }
  }
}
