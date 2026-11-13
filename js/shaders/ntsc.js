// SPDX-License-Identifier: AGPL-3.0-or-later
//
// NTSC composite video, after ntsc-wasm by noxylva
// (https://github.com/Nedifinita/ntsc-wasm), itself after ntscQT and
// composite-video-simulator. This file ports its signal path to fragment
// shaders, so it is under the GNU Affero General Public License v3 or later,
// as ntsc-wasm is.
//
// Every pass but the last works on the raster: 480 lines of samples taken at
// four times the colour subcarrier (14.318 MHz), so a cycle of the subcarrier
// is four samples. Buffers hold Y, I and Q in r, g and b, on ntsc-wasm's
// 0..255 scale, in float, sampled texel by texel (see NTSC Module in
// ARCHITECTURE.md).

const COMMON = `
precision highp float;
varying vec2 vTexCoord;
uniform vec2 uSize;          // raster, in samples x lines

vec2 here() { return floor(vTexCoord * uSize); }
vec4 at(sampler2D t, float x, float y) { return texture2D(t, (vec2(x, y) + 0.5) / uSize); }

uniform float uSeed;
// Dave Hoskins' hash without sine, which differs between GPUs
float hash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
// A whole number from -n to n, the same for the same sample, line and salt
// all frame
float rnd(float x, float y, float salt, float n) {
  return floor(hash(vec3(x + 0.37, y + salt * 613.0 + 0.71, uSeed)) * (2.0 * n + 1.0)) - n;
}
`;

// The subcarrier's phase at the start of line y, in samples (ntsc-wasm's
// chromaLumaXi, with the field as the line's parity). uPhase picks the
// scanline phase shift: 0, 90, 180 or 270 degrees.
const XI = `
uniform float uPhase;
uniform float uOffset;
float xiAt(float y) {
  float f = mod(y, 2.0);
  if (uPhase < 0.5) return mod(uOffset, 4.0);
  if (uPhase < 1.5) return mod(f + uOffset + floor(y / 2.0), 4.0);
  if (uPhase < 2.5) return mod(mod(floor((f + y) / 2.0), 2.0) * 2.0 + uOffset, 4.0);
  return mod(f + uOffset, 4.0);
}
`;

// What happens to each line this frame, one texel a line:
//   r  VHS edge wave: samples the line shifts right
//   g  chroma phase noise: radians the chroma turns
//   b  1 where the line loses its chroma
//   a  head switching: samples the line's luma shifts left, 0 for none
export const ntscLinesFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform float uLines;
uniform float uSeed;
uniform float uEdgeWave;     // 0 for none, else shifts up to n - 1 either way
uniform float uEdgeAlpha;    // low-pass down the field, at the tape's luma cut
uniform float uPhaseNoise;
uniform float uLoss;         // chance a line loses its chroma
uniform float uHead;         // 1: head switching
uniform vec2 uHeadStart;     // per field, the line the shift starts below
uniform vec2 uHeadShift;     // per field, its first line's shift

float hash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float lineRnd(float y, float salt) { return hash(vec3(salt * 97.0 + 0.37, y + 0.71, uSeed)); }

void main() {
  float y = floor(vTexCoord.y * uLines);
  float f = mod(y, 2.0);
  float j = floor(y / 2.0);   // the line's place in its field

  // Edge wave: a random shift a line, low-passed down the field from 0
  float edge = 0.0;
  if (uEdgeWave > 0.5) {
    float w = uEdgeAlpha;
    for (int k = 0; k < 48; k++) {
      float m = j - float(k);
      if (m < 0.0) break;
      float r = floor(lineRnd(m * 2.0 + f, 1.0) * (2.0 * uEdgeWave - 1.0)) - (uEdgeWave - 1.0);
      edge += w * r;
      w *= 1.0 - uEdgeAlpha;
    }
    edge = edge < 0.0 ? ceil(edge) : floor(edge);
  }

  // Phase noise: each line halves the last line's noise and adds its own
  float phase = 0.0;
  if (uPhaseNoise > 0.0) {
    float w = 0.5;
    for (int k = 0; k < 24; k++) {
      float m = j - float(k);
      if (m < 0.0) break;
      phase += w * (floor(lineRnd(m * 2.0 + f, 2.0) * (2.0 * uPhaseNoise + 1.0)) - uPhaseNoise);
      w *= 0.5;
    }
    phase *= 3.14159265 / 100.0;
  }

  float loss = lineRnd(y, 3.0) < uLoss ? 1.0 : 0.0;

  // Head switching: the shift starts the line after the switch point and
  // shrinks by an eighth a line, in whole samples
  float head = 0.0;
  float start = f < 0.5 ? uHeadStart.x : uHeadStart.y;
  if (uHead > 0.5 && y > start) {
    head = f < 0.5 ? uHeadShift.x : uHeadShift.y;
    float k = (y - start) / 2.0 - 1.0;
    for (int i = 0; i < 64; i++) {
      if (float(i) >= k || head < 1.0) break;
      head = floor(head * 7.0 / 8.0);
    }
  }

  gl_FragColor = vec4(edge, phase, loss, head);
}
`;

// RGB to YIQ, with colour bleed: I and Q are taken uBleed samples and lines
// back, where that is inside the raster
export const ntscEncodeFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;      // the input, any size
uniform vec2 uSize;
uniform vec2 uBleed;

vec3 rgbAt(vec2 p) { return texture2D(tex0, (p + 0.5) / uSize).rgb * 255.0; }

void main() {
  vec2 p = floor(vTexCoord * uSize);
  vec3 c = rgbAt(p);
  vec2 q = p - uBleed;
  vec3 b = (q.x >= 0.0 && q.y >= 0.0 && q.x < uSize.x && q.y < uSize.y) ? rgbAt(q) : c;
  float Y = (77.0 * c.r + 151.0 * c.g + 28.0 * c.b) / 256.0;
  float Yb = (77.0 * b.r + 151.0 * b.g + 28.0 * b.b) / 256.0;
  float I = (189.0 * (b.r - Yb) - 69.0 * (b.b - Yb)) / 256.0;
  float Q = (123.0 * (b.r - Yb) + 105.0 * (b.b - Yb)) / 256.0;
  gl_FragColor = vec4(Y, I, Q, 1.0);
}
`;

// Three identical one-pole low-passes in a row, along the line, per
// component: ntsc-wasm's LowpassFilters, as their impulse response
// a^3 (k+1)(k+2)/2 (1-a)^k. Each starts at the component's uReset level, as
// the filters do, and the output is read uDelay samples ahead to undo the
// filter's lag; the last uDelay samples keep their input, as in ntsc-wasm.
// A component whose uAlpha is 0 passes through. With uEdge the line is first
// shifted by the edge wave, repeating its end samples, and with uLoss a line
// marked for chroma loss comes out with none.
export const ntscLowpassFrag = `${COMMON}
uniform sampler2D tex0;
uniform sampler2D uLinesTex;
uniform vec3 uAlpha;
uniform vec3 uDelay;
uniform vec3 uReset;
uniform vec3 uTaps;
uniform float uEdge;
uniform float uLoss;
const int MAX_TAPS = 160;

vec3 src(float x, float y, float shift) {
  return at(tex0, clamp(x - shift, 0.0, uSize.x - 1.0), y).rgb;
}

float cascade(vec2 p, float shift, vec3 mask, float a, float d, float r, float taps) {
  float a3 = a * a * a, q = 1.0, sum = 0.0, wsum = 0.0;
  for (int i = 0; i <= MAX_TAPS; i++) {
    float k = float(i);
    if (k > taps) break;
    float n = p.x + d - k;
    if (n < 0.0) break;    // before the line, the filter holds its reset level
    float w = a3 * 0.5 * (k + 1.0) * (k + 2.0) * q;
    sum += w * dot(src(n, p.y, shift), mask);
    wsum += w;
    q *= 1.0 - a;
  }
  return sum + r * (1.0 - wsum);
}

void main() {
  vec2 p = here();
  vec4 line = texture2D(uLinesTex, vec2(0.5, (p.y + 0.5) / uSize.y));
  float shift = uEdge * line.r;
  vec3 v = src(p.x, p.y, shift);
  vec3 o = v;
  if (uAlpha.x > 0.0 && p.x < uSize.x - uDelay.x)
    o.x = cascade(p, shift, vec3(1.0, 0.0, 0.0), uAlpha.x, uDelay.x, uReset.x, uTaps.x);
  if (uAlpha.y > 0.0 && p.x < uSize.x - uDelay.y)
    o.y = cascade(p, shift, vec3(0.0, 1.0, 0.0), uAlpha.y, uDelay.y, uReset.y, uTaps.y);
  if (uAlpha.z > 0.0 && p.x < uSize.x - uDelay.z)
    o.z = cascade(p, shift, vec3(0.0, 0.0, 1.0), uAlpha.z, uDelay.z, uReset.z, uTaps.z);
  if (uLoss > 0.5 && line.b > 0.5) o.yz = vec2(0.0);
  gl_FragColor = vec4(o, 1.0);
}
`;

// Luma plus uGain times its high-pass: x + g (x - lp(x)), where lp is one
// one-pole low-pass (uOrder 1) or three (uOrder 3) starting at uReset. It is
// composite pre-emphasis, the VHS luma peaking and VHS sharpening. With
// uVBlend, I and Q are averaged with the same field's line above (the VHS
// chroma comb's line delay).
export const ntscBoostFrag = `${COMMON}
uniform sampler2D tex0;
uniform float uOrder;
uniform float uAlpha;
uniform float uReset;
uniform float uTaps;
uniform float uGain;
uniform float uVBlend;
const int MAX_TAPS = 160;

void main() {
  vec2 p = here();
  vec3 v = at(tex0, p.x, p.y).rgb;
  float a = uAlpha, a3 = a * a * a, q = 1.0, sum = 0.0, wsum = 0.0;
  for (int i = 0; i <= MAX_TAPS; i++) {
    float k = float(i);
    if (k > uTaps) break;
    float n = p.x - k;
    if (n < 0.0) break;
    float w = uOrder < 2.0 ? a * q : a3 * 0.5 * (k + 1.0) * (k + 2.0) * q;
    sum += w * at(tex0, n, p.y).r;
    wsum += w;
    q *= 1.0 - a;
  }
  float lp = sum + uReset * (1.0 - wsum);
  vec3 o = vec3(v.x + uGain * (v.x - lp), v.yz);
  if (uVBlend > 0.5 && p.y >= 2.0) o.yz = (at(tex0, p.x, p.y - 2.0).yz + v.yz) * 0.5;
  gl_FragColor = vec4(o, 1.0);
}
`;

// Ringing, ntsc-wasm's first kind: each component plus a tenth of
// (uRinging - 1) times its central difference
export const ntscRingSimpleFrag = `${COMMON}
uniform sampler2D tex0;
uniform float uRinging;

void main() {
  vec2 p = here();
  vec3 v = at(tex0, p.x, p.y).rgb;
  if (p.x >= 1.0 && p.x <= uSize.x - 2.0) {
    v += (at(tex0, p.x + 1.0, p.y).rgb - at(tex0, p.x - 1.0, p.y).rgb) * (uRinging - 1.0) * 0.1;
  }
  gl_FragColor = vec4(v, 1.0);
}
`;

// Ringing, the second kind: each line filtered by the measured ring pattern
// raised to a power. ntsc-wasm multiplies the line's spectrum by it; the same
// filter is this convolution, round the line as an FFT's is, with the kernel
// NTSCModule works out from the pattern (195 taps, centre at 97).
export const NTSC_RING_TAPS = 97;
export const ntscRingPatternFrag = `${COMMON}
uniform sampler2D tex0;
uniform vec4 uKernel[49];

vec3 tap(vec2 p, float k) { return at(tex0, mod(p.x - k + uSize.x * 4.0, uSize.x), p.y).rgb; }

void main() {
  vec2 p = here();
  vec3 s = vec3(0.0);
  for (int j = 0; j < 49; j++) {
    vec4 w = uKernel[j];
    float k = float(j * 4) - 97.0;
    s += w.x * tap(p, k) + w.y * tap(p, k + 1.0) + w.z * tap(p, k + 2.0) + w.w * tap(p, k + 3.0);
  }
  gl_FragColor = vec4(s, 1.0);
}
`;

// Chroma into luma: the subcarrier, a sample a quarter of its cycle, carries
// +I, +Q, -I, -Q in turn, at uAmp / 50 of their size. I and Q go to 0.
export const ntscModulateFrag = `${COMMON}${XI}
uniform sampler2D tex0;
uniform float uAmp;

void main() {
  vec2 p = here();
  vec3 v = at(tex0, p.x, p.y).rgb;
  float ph = mod(xiAt(p.y) + p.x, 4.0);
  float c = ph < 0.5 ? v.y : ph < 1.5 ? v.z : ph < 2.5 ? -v.y : -v.z;
  gl_FragColor = vec4(v.x + c * uAmp / 50.0, 0.0, 0.0, 1.0);
}
`;

// Video noise, then head switching, on the composite signal. The noise is a
// whole number from -uNoise to uNoise a sample, low-passed by halves along
// the line and read one sample late, as in ntsc-wasm. A line the lines pass
// shifts reads its samples s further on, round a line 1.1 times the raster's
// width, whose extra tenth is black.
export const ntscNoiseFrag = `${COMMON}
uniform sampler2D tex0;
uniform sampler2D uLinesTex;
uniform float uNoise;

float signal(float x, float y) {
  float v = at(tex0, x, y).r;
  if (uNoise > 0.0) {
    float w = 0.5;
    for (int k = 0; k < 16; k++) {
      v += w * rnd(x - 1.0 - float(k), y, 4.0, uNoise);
      w *= 0.5;
    }
  }
  return v;
}

void main() {
  vec2 p = here();
  float shift = texture2D(uLinesTex, vec2(0.5, (p.y + 0.5) / uSize.y)).a;
  float x = p.x;
  float v;
  if (shift > 0.5) {
    float tw = uSize.x + floor(uSize.x / 10.0);
    x = mod(p.x + shift, tw);
    v = x < uSize.x ? signal(x, p.y) : 0.0;
  } else {
    v = signal(x, p.y);
  }
  gl_FragColor = vec4(v, 0.0, 0.0, 1.0);
}
`;

// The receiver's decoder (ntsc-wasm's chromaFromLuma). Luma is a four-sample
// box, which a cycle of the subcarrier sums to nothing in; chroma is what the
// box takes out, two samples on, its sign undone a half cycle in two. I and Q
// are read from alternate samples and the samples between are interpolated.
// With uDecode 0 it is a black and white set: the luma keeps the subcarrier.
// Then chroma noise (white, per sample) and phase noise (per line) are added.
export const ntscDecodeFrag = `${COMMON}${XI}
uniform sampler2D tex0;
uniform sampler2D uLinesTex;
uniform float uAmp;
uniform float uDecode;
uniform float uChromaNoise;
uniform float uPhaseOn;

float sig(float x, float y) {
  return (x < 0.0 || x >= uSize.x) ? 0.0 : at(tex0, x, y).r;
}
float box(float x, float y) {
  return (sig(x - 1.0, y) + sig(x, y) + sig(x + 1.0, y) + sig(x + 2.0, y)) * 0.25;
}
float chroma(float i, float y, float xi) {
  float c = sig(i + 2.0, y) - box(i, y);
  // ntsc-wasm starts undoing the sign at sample x0 + 2, so a line's first
  // samples keep theirs
  if (mod(i + xi, 4.0) >= 2.0 && i >= mod(4.0 - xi, 4.0) + 2.0) c = -c;
  return uAmp > 0.0 ? c * 50.0 / uAmp : 0.0;
}
// I and Q at an even sample
vec2 iqEven(float x, float y, float xi) {
  return vec2(x + xi < uSize.x ? -chroma(x + xi, y, xi) : 0.0,
              x + xi + 1.0 < uSize.x ? -chroma(x + xi + 1.0, y, xi) : 0.0);
}

void main() {
  vec2 p = here();
  vec3 o;
  if (uDecode > 0.5) {
    float xi = xiAt(p.y);
    o.x = box(p.x, p.y);
    if (p.x >= uSize.x - 2.0) {
      o.yz = vec2(0.0);
    } else if (mod(p.x, 2.0) < 0.5) {
      o.yz = iqEven(p.x, p.y, xi);
    } else {
      o.yz = (iqEven(p.x - 1.0, p.y, xi) + iqEven(p.x + 1.0, p.y, xi)) * 0.5;
    }
  } else {
    o = vec3(at(tex0, p.x, p.y).r, 0.0, 0.0);
  }
  if (uChromaNoise > 0.0) {
    o.y += rnd(p.x, p.y, 5.0, uChromaNoise);
    o.z += rnd(p.x, p.y, 6.0, uChromaNoise);
  }
  if (uPhaseOn > 0.5) {
    float a = texture2D(uLinesTex, vec2(0.5, (p.y + 0.5) / uSize.y)).g;
    float c = cos(a), s = sin(a);
    o.yz = vec2(o.y * c - o.z * s, o.y * s + o.z * c);
  }
  gl_FragColor = vec4(o, 1.0);
}
`;

// The set's last chroma blur (1, 2, 1 along the line), then YIQ to RGB
export const ntscRgbFrag = `${COMMON}
uniform sampler2D tex0;

void main() {
  vec2 p = here();
  vec3 v = at(tex0, p.x, p.y).rgb;
  if (p.x >= 1.0 && p.x <= uSize.x - 2.0) {
    v.yz = (at(tex0, p.x - 1.0, p.y).yz + 2.0 * v.yz + at(tex0, p.x + 1.0, p.y).yz) * 0.25;
  }
  vec3 rgb = vec3(v.x + (245.0 * v.y + 159.0 * v.z) / 256.0,
                  v.x - (70.0 * v.y + 166.0 * v.z) / 256.0,
                  v.x + (-283.0 * v.y + 436.0 * v.z) / 256.0);
  gl_FragColor = vec4(clamp(rgb / 255.0, 0.0, 1.0), 1.0);
}
`;
