// Matte — composites fg over bg through a matte taken from input a: its alpha,
// or its BT.601 luma. Choke erodes the matte by that many logical pixels, and a
// negative Choke spreads it, with a min (or max) over a square, done as two
// separable passes:
//
//   matteChokeFrag  the matte, and its extreme along x, into a working buffer
//   matteFrag       its extreme along y, then mix(bg, fg, matte * mix)
//
// At Choke 0 the first pass is skipped and matteFrag reads the matte from a
// itself. A fractional radius blends in the next tap out by its fraction, so
// the edge moves smoothly as the knob turns.

// Most taps either side of a pixel, in physical pixels: past Choke's 20 at
// density 3, so only a typed value reaches it
export const MATTE_MAX_TAPS = 64;

const extreme = `
// The min of the matte over taps -n..n along uStep, and the next tap out
// blended in by f. uSign is 1 to choke (min) and -1 to spread (max), which
// runs the same min on the negated matte.
float extreme(vec2 uv) {
  float v = uSign * sampleMatte(uv);
  for (int k = 1; k <= MATTE_MAX_TAPS; k++) {
    float fk = float(k);
    if (fk > uTaps + 1.0) break;
    float t = min(uSign * sampleMatte(uv + fk * uStep), uSign * sampleMatte(uv - fk * uStep));
    v = fk <= uTaps ? min(v, t) : min(v, mix(v, t, uFrac));
  }
  return uSign * v;
}
`;

export const matteChokeFrag = `
precision highp float;
#define MATTE_MAX_TAPS ${MATTE_MAX_TAPS}
varying vec2 vTexCoord;

uniform sampler2D tex0; // a, the matte's source
uniform float uLuma;    // 0: a's alpha, 1: a's luma
uniform vec2 uStep;     // one physical pixel along x, in uv
uniform float uTaps;    // whole taps either side
uniform float uFrac;    // share of the next tap out
uniform float uSign;    // 1 chokes, -1 spreads

float sampleMatte(vec2 uv) {
  vec4 c = texture2D(tex0, uv);
  return uLuma > 0.5 ? dot(c.rgb, vec3(0.299, 0.587, 0.114)) : c.a;
}
${extreme}
void main() {
  float m = extreme(vTexCoord);
  gl_FragColor = vec4(vec3(m), 1.0);
}
`;

export const matteFrag = `
precision highp float;
#define MATTE_MAX_TAPS ${MATTE_MAX_TAPS}
varying vec2 vTexCoord;

uniform sampler2D tex0; // fg
uniform sampler2D tex1; // bg
uniform sampler2D tex2; // a at Choke 0, else matteChokeFrag's buffer
uniform float uHasBg;   // 0: bg is transparent black
uniform float uChoked;  // 1: tex2 is the working buffer, its matte in red
uniform float uLuma;
uniform vec2 uStep;     // one physical pixel along y, in uv
uniform float uTaps;
uniform float uFrac;
uniform float uSign;
uniform float uMix;

float sampleMatte(vec2 uv) {
  return texture2D(tex2, uv).r;
}
${extreme}
void main() {
  vec4 fg = texture2D(tex0, vTexCoord);
  vec4 bg = uHasBg > 0.5 ? texture2D(tex1, vTexCoord) : vec4(0.0);
  float m;
  if (uChoked > 0.5) {
    m = extreme(vTexCoord);
  } else {
    vec4 a = texture2D(tex2, vTexCoord);
    m = uLuma > 0.5 ? dot(a.rgb, vec3(0.299, 0.587, 0.114)) : a.a;
  }
  gl_FragColor = mix(bg, fg, clamp(m * uMix, 0.0, 1.0));
}
`;
