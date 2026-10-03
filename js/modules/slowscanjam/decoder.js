// SlowscanDecoder from the SlowscanJam project (index.html): turns the stereo
// Cassette Video signal back into scanlines. The sample loop is the project's,
// unchanged apart from how many samples a line keeps (see maxColorsPerLine).
// What it no longer needs here is gone: the AudioContext (it only
// supplied a sample rate for live line-in, and this decoder is always told the
// encoder's), its own requestAnimationFrame draw loop, and the phosphor
// renderer, which SlowscanJamModule now does in p5. Each decoded line waits in
// `lines` until the module draws it and hands it back with releaseLine().
//
// Sample loop is sequential by nature (feedback AGC + sync tracking), so it
// stays on CPU. All per-sample allocations have been eliminated: chromaDelay,
// noise, and per-line sample arrays are preallocated. Lines store
// AGC-normalized YCbCr; RGB conversion, brightness and saturation are applied
// by the renderer (in a shader).
const DECODER_LINE_POOL_MAX = 1024;

export class SlowscanDecoder {
  constructor(config = {}) {
    const defaults = {
      overScan: 0.82,
      hOffset: 0.06525,
      pulseLength: 0.2 / 1000,
      hFreq: 225.0,
      vFreq: 3
    };
    const cfg = { ...defaults, ...config };
    this.sig = { LMin: 0.0, LMax: 1.0, CMin: -1.0, CMax: 1.0 };
    this.hPhase = 0;
    this.vPhase = 0;

    this.pulse = { time: 0, timeout: 0, luma: 0, lumaPrev: 0, chroma: 0, chromaPrev: 0, changed: false, ready: false };
    this.timing = { time: 0, lastV: 0, lastH: 0 };
    this.field = 0;
    this.chromaField = 0;
    this.chromaDelayIndex = 0;
    this.lines = [];
    this.linePool = [];
    this.overScan = cfg.overScan;
    this.hOffset = cfg.hOffset;
    this.pulseLength = cfg.pulseLength;

    // Size of the picture the lines are laid out on
    this.width = cfg.width;
    this.height = cfg.height;

    // Rate of the signal being decoded: the encoder's
    this.sampleRate = cfg.sampleRate;
    this.hFreqTarget = 1.0 / cfg.hFreq * this.sampleRate;
    this.vFreqTarget = 1.0 / cfg.vFreq * this.sampleRate;
    this.hFreq = this.hFreqTarget;
    this.vFreq = this.vFreqTarget;

    // Room for one line's samples. The app kept at most 1024, but a line runs
    // sampleRate / hFreq samples, which passes 1024 below fps x lines = 187.5
    // (3840 at 1 fps and 50 lines), and its WebGL renderer then ended each line
    // at the last sample kept: only the left part of the picture showed. Sync
    // tracking can stretch a line to 1.5 times its nominal length before the
    // phase wraps, so this keeps twice that.
    this.maxColorsPerLine = Math.ceil(this.hFreqTarget * 2) + 16;

    // Preallocated chroma delay line (one scanline worth of samples).
    this.chromaDelayMax = Math.ceil(this.sampleRate / 10.0) + 16;
    this.chromaDelay = new Float32Array(this.chromaDelayMax);

    // Cheap pseudo-noise LUT reused across samples. Math.random() in the
    // hot loop was a measurable cost; decorrelated indices avoid giving
    // L and C identical jitter.
    this.noiseLUTSize = 4096;
    this.noiseLUT = new Float32Array(this.noiseLUTSize);
    for (let i = 0; i < this.noiseLUTSize; i++) {
      this.noiseLUT[i] = Math.random() * 0.01 - 0.005;
    }
    this.noiseIdxL = 0;
    this.noiseIdxC = this.noiseLUTSize >> 1;

    this.currLine = this.acquireLine();
  }

  acquireLine() {
    const l = this.linePool.pop();
    if (l) { l.count = 0; return l; }
    return {
      x1: 0, y: 0, x2: 0, maxPhase: 0, count: 0,
      phase: new Float32Array(this.maxColorsPerLine),
      ycc: new Float32Array(this.maxColorsPerLine * 3)
    };
  }

  releaseLine(l) {
    if (this.linePool.length < DECODER_LINE_POOL_MAX) {
      this.linePool.push(l);
    }
  }

  process(lSamples, cSamples) {
    const sampleRate = this.sampleRate;
    const sRateInv = 1.0 / sampleRate;
    const s = this.sig;
    const p = this.pulse;
    const nLUT = this.noiseLUT;
    const nMask = this.noiseLUTSize - 1;
    const chromaDelay = this.chromaDelay;
    const chromaDelayCap = (sampleRate / 10.0) | 0;
    const invOverScan = 1.0 / this.overScan;
    const widthPx = this.width;
    const halfPulse = this.pulseLength * 0.5;

    const n = lSamples.length;
    for (let i = 0; i < n; i++) {
      this.timing.time += 1;

      const lSample = lSamples[i] + nLUT[(this.noiseIdxL = (this.noiseIdxL + 1) & nMask)];
      const cSample = cSamples[i] + nLUT[(this.noiseIdxC = (this.noiseIdxC + 1) & nMask)];

      if (lSample < s.LMin) s.LMin = lSample;
      if (lSample > s.LMax) s.LMax = lSample;
      s.LMin *= 1.0 - sRateInv;
      s.LMax *= 1.0 - sRateInv;
      if (s.LMin > -0.025) s.LMin = -0.025;
      if (s.LMax < 0.025) s.LMax = 0.025;

      if (cSample < s.CMin) s.CMin = cSample;
      if (cSample > s.CMax) s.CMax = cSample;
      s.CMin *= 1.0 - sRateInv;
      s.CMax *= 1.0 - sRateInv;
      if (s.CMin > -0.05) s.CMin = -0.05;
      if (s.CMax < 0.05) s.CMax = 0.05;

      // Normalized levels (0..1 for picture content). Brightness,
      // saturation and YCbCr->RGB are applied at draw time.
      const luma = (lSample * 2.0 - s.LMin) / (s.LMax - s.LMin);
      const chroma = (cSample * 2.0 - s.CMin) / (s.CMax - s.CMin);
      const chromaLast = chromaDelay[this.chromaDelayIndex];

      if (this.chromaDelayIndex < chromaDelayCap) {
        chromaDelay[this.chromaDelayIndex] = chroma;
        this.chromaDelayIndex++;
      }

      const cl = this.currLine;
      if (cl.count < this.maxColorsPerLine) {
        const n2 = cl.count;
        cl.phase[n2] = this.hPhase;
        const o = n2 * 3;
        cl.ycc[o] = luma;
        if (this.chromaField === 0) { cl.ycc[o + 1] = chromaLast; cl.ycc[o + 2] = chroma; }
        else { cl.ycc[o + 1] = chroma; cl.ycc[o + 2] = chromaLast; }
        cl.count = n2 + 1;
      }
      cl.maxPhase = this.hPhase;

      this.hPhase += 1.0 / this.hFreq;
      this.vPhase += 1.0 / this.vFreq;
      cl.x2 = (this.hPhase - this.hOffset) * invOverScan * widthPx;

      let blank = false;

      if ((s.LMax - s.LMin) > 0.1 && (s.CMax - s.CMin) > 0.1) {
        p.luma = lSample < s.LMin * 0.5 ? -1 : (lSample > s.LMax * 0.5 ? 1 : 0);
        p.chroma = cSample < s.CMin * 0.5 ? -1 : (cSample > s.CMax * 0.5 ? 1 : 0);

        if (p.luma !== p.lumaPrev || p.chroma !== p.chromaPrev) {
          p.time = 0;
          p.lumaPrev = p.luma;
          p.chromaPrev = p.chroma;
          p.changed = true;
        }

        if (p.luma !== 0 && p.chroma !== 0) {
          p.time += sRateInv;
          if (p.time > halfPulse && p.changed) {
            p.changed = false;
            if (!p.ready) {
              p.ready = true;
              p.timeout = this.pulseLength * 1.25;
            } else {
              p.ready = false;
              blank = true;
              const dH = this.timing.time - this.timing.lastH;
              if (dH < this.hFreqTarget * 1.5 && dH > this.hFreqTarget * 0.5) {
                this.hFreq = this.hFreq * 0.9 + dH * 0.1;
              }
              this.timing.lastH = this.timing.time;
              this.hPhase = 0;
              this.chromaDelayIndex = 0;
              this.chromaField = p.luma > 0 ? 0 : 1;
              if (p.luma !== p.chroma) {
                const dV = this.timing.time - this.timing.lastV;
                if (dV < this.vFreqTarget * 1.5 && dV > this.vFreqTarget * 0.5) {
                  this.vFreq = this.vFreq * 0.75 + dV * 0.25;
                }
                this.timing.lastV = this.timing.time;
                this.vPhase = 0;
                this.chromaField = 1;
                this.field = p.luma > 0 ? 0 : 1;
              }
            }
          }
        }
      }

      this.hFreq = this.hFreq * (1.0 - sRateInv) + this.hFreqTarget * sRateInv;
      this.vFreq = this.vFreq * (1.0 - sRateInv) + this.vFreqTarget * sRateInv;

      if (this.hPhase >= 1.0) {
        blank = true;
        this.hPhase -= 1.0;
        this.chromaDelayIndex = 0;
        this.chromaField = this.chromaField === 1 ? 0 : 1;
      }
      if (this.vPhase >= 1.0) {
        blank = true;
        this.vPhase -= 1.0;
        this.field = this.field === 0 ? 1 : 0;
      }

      if (blank) {
        if (this.lines.length < 1024 && cl.count > 5 && cl.maxPhase > 0) {
          this.lines.push(cl);
        } else {
          this.releaseLine(cl);
        }
        const nl = this.acquireLine();
        nl.x1 = (this.hPhase - this.hOffset) * invOverScan * widthPx;
        nl.y = (this.vPhase + (this.field / this.vFreq) * this.hFreq * 0.5) * this.height;
        nl.x2 = 0;
        nl.maxPhase = 0;
        this.currLine = nl;
      }
    }
  }
}
