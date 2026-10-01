// Blur — three classic approaches behind one set of controls.
//
//   Gaussian  separable two-pass convolution, bilinear-paired taps
//   Kawase    Bjørge's dual filter: a down/up pyramid of tiny kernels
//   Bokeh     golden-angle disc gather, like an out-of-focus lens
//
// Every mode blurs in linear light, so highlights keep their brightness
// instead of greying out. Highlights then expand toward HDR on the way in, by
// an inverse Reinhard curve on each pixel's brightest channel, and compress
// by the matching Reinhard curve on the way out. The pair is an exact inverse,
// so flat areas come back unchanged, but inside the blur a bright pixel
// carries up to 1 / (1 - alpha) times its light and blooms over dark ones, the
// way a real lens spreads a highlight much brighter than the screen can show.
//
// Taps that land past the image edge are dropped and the rest renormalised,
// rather than clamped. Clamping repeats the edge texel, which at a coarse
// working scale stands for a wide average, so the border would change every
// time the radius stepped to a new scale (and streak besides).
//
// See BlurModule.js for how the passes are scheduled and scaled.

export const BLUR_MAX_PAIRS = 20;    // Gaussian taps per side, as bilinear pairs
export const BLUR_MAX_BOKEH = 128;   // golden-angle samples per pixel
export const BLUR_BOKEH_RIM = 0.3;    // extra weight at a disc's edge, as on real lens bokeh

// A tap weighted k inside the image and 0 past its edge; adds the weight to w
const TAP = `
vec4 tapIn(sampler2D t, vec2 uv, float k, inout float w) {
  vec2 inside = step(vec2(0.0), uv) * step(uv, vec2(1.0));
  float m = k * inside.x * inside.y;
  w += m;
  return texture2D(t, uv) * m;
}
`;

const LINEAR = `
vec3 toLinear(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
vec3 toDisplay(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }
`;

// Linearise and expand the highlights, at full resolution. Downscaling comes
// after, in linear light: averaging first would darken small highlights,
// since a 1-pixel line averaged with its dark neighbour into one texel
// linearises to 0.5^2.2 rather than 0.5, losing more than half its energy.
// Scaled by (1 - alpha) so the brightest result is 1 and fits an 8-bit buffer
// when half float is unavailable.
export const blurPrepFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform float u_alpha;     // highlight expansion, 0 (none) to just under 1
${LINEAR}
void main() {
  vec3 c = toLinear(texture2D(tex0, vTexCoord).rgb);
  float m = max(c.r, max(c.g, c.b));
  gl_FragColor = vec4(c * (1.0 - u_alpha) / (1.0 - u_alpha * m), 1.0);
}`;

// Halve a buffer: at a half-size texel's centre, one bilinear fetch is the
// exact mean of the 2x2 block under it
export const blurHalveFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
void main() {
  gl_FragColor = texture2D(tex0, vTexCoord);
}`;

// One axis of the separable Gaussian. Pair i blends texels 2i-1 and 2i in a
// single bilinear fetch, placed between them by their weights, which halves
// the fetches with no change to the kernel.
export const blurGaussianFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform vec2 u_step;                          // one texel along this pass's axis
uniform float u_offsets[${BLUR_MAX_PAIRS + 1}];
uniform float u_weights[${BLUR_MAX_PAIRS + 1}];
uniform int u_pairs;
${TAP}
void main() {
  float w = u_weights[0];
  vec4 sum = texture2D(tex0, vTexCoord) * w;
  for (int i = 1; i <= ${BLUR_MAX_PAIRS}; i++) {
    if (i > u_pairs) break;
    vec2 o = u_step * u_offsets[i];
    sum += tapIn(tex0, vTexCoord + o, u_weights[i], w) + tapIn(tex0, vTexCoord - o, u_weights[i], w);
  }
  gl_FragColor = sum / w;
}`;

// Dual filter downsample (Bjørge, SIGGRAPH 2015): the 2x2 block under this
// half-size texel, weighted 4, plus the four diagonal blocks round it.
export const blurKawaseDownFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform vec2 u_texel;      // one source texel
${TAP}
void main() {
  vec2 d = u_texel;
  float w = 4.0;
  vec4 sum = texture2D(tex0, vTexCoord) * w;
  sum += tapIn(tex0, vTexCoord + vec2(-d.x, -d.y), 1.0, w);
  sum += tapIn(tex0, vTexCoord + vec2( d.x, -d.y), 1.0, w);
  sum += tapIn(tex0, vTexCoord + vec2(-d.x,  d.y), 1.0, w);
  sum += tapIn(tex0, vTexCoord + vec2( d.x,  d.y), 1.0, w);
  gl_FragColor = sum / w;
}`;

const KAWASE_UP = `
// Dual filter upsample: a tent of four axis taps one source texel out and
// four diagonal taps half a texel out, weighted 2
vec4 kawaseUp(sampler2D t, vec2 uv, vec2 d) {
  float w = 0.0;
  vec4 sum = tapIn(t, uv + vec2(-d.x, 0.0), 1.0, w);
  sum += tapIn(t, uv + vec2( d.x, 0.0), 1.0, w);
  sum += tapIn(t, uv + vec2(0.0, -d.y), 1.0, w);
  sum += tapIn(t, uv + vec2(0.0,  d.y), 1.0, w);
  sum += tapIn(t, uv + vec2(-d.x, -d.y) * 0.5, 2.0, w);
  sum += tapIn(t, uv + vec2( d.x, -d.y) * 0.5, 2.0, w);
  sum += tapIn(t, uv + vec2(-d.x,  d.y) * 0.5, 2.0, w);
  sum += tapIn(t, uv + vec2( d.x,  d.y) * 0.5, 2.0, w);
  return sum / w;
}
`;

export const blurKawaseUpFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform vec2 u_texel;      // one source texel
${TAP}
${KAWASE_UP}
void main() {
  gl_FragColor = kawaseUp(tex0, vTexCoord, u_texel);
}`;

// A 3x3 tent [1 2 1] x [1 2 1] / 16 in four bilinear fetches. Run on the
// source before the bokeh gather, it widens every highlight past the gap
// between gather samples, so a small bright point stamps a smooth disc
// instead of a speckled one.
export const blurTentFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform vec2 u_texel;
${TAP}
void main() {
  vec2 h = u_texel * 0.5;
  float w = 0.0;
  vec4 sum = tapIn(tex0, vTexCoord + vec2(-h.x, -h.y), 1.0, w) + tapIn(tex0, vTexCoord + vec2(h.x, -h.y), 1.0, w)
           + tapIn(tex0, vTexCoord + vec2(-h.x, h.y), 1.0, w) + tapIn(tex0, vTexCoord + vec2(h.x, h.y), 1.0, w);
  gl_FragColor = sum / w;
}`;

// Golden-angle disc gather. Sample i turns by 137.5 degrees from the last and
// sits at radius sqrt(i), which spreads any count evenly over the disc with no
// rings or spokes. On its own that leaves the edge to a few scattered outer
// samples, so the disc reads as a lopsided polygon; the last 2 sqrt(n) samples
// are instead put on the rim itself (Vogel's spiral with a smooth boundary),
// which rounds it. The rim is weighted up a little, the way real lens bokeh
// has a brighter edge.
export const blurBokehFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform vec2 u_texel;      // one texel of this buffer
uniform float u_radius;    // disc radius, in texels of this buffer
uniform int u_count;

#define GOLDEN_ANGLE 2.39996323
#define RIM ${BLUR_BOKEH_RIM.toFixed(3)}
${TAP}

void main() {
  vec4 sum = vec4(0.0);
  float total = 0.0;
  float n = float(u_count);
  float rim = floor(2.0 * sqrt(n) + 0.5);
  float inner = sqrt(n - (rim + 1.0) * 0.5);
  for (int i = 0; i < ${BLUR_MAX_BOKEH}; i++) {
    if (i >= u_count) break;
    float fi = float(i);
    float r = fi >= n - rim ? 1.0 : sqrt(fi + 0.5) / inner;
    float a = fi * GOLDEN_ANGLE;
    sum += tapIn(tex0, vTexCoord + vec2(cos(a), sin(a)) * r * u_radius * u_texel, 1.0 + RIM * r * r, total);
  }
  gl_FragColor = sum / total;
}`;

// Back to display: undo the prep's scaling, compress the highlights back
// (exactly inverting the prep for any pixel the blur left alone), re-encode,
// and mix with the untouched input. Two blurred sources, crossfaded by u_ab, let Kawase
// glide between pyramid depths; either can take the dual-filter upsample on
// the way in.
export const blurCompositeFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;    // the input
uniform sampler2D u_a;
uniform sampler2D u_b;
uniform vec2 u_texelA;
uniform vec2 u_texelB;
uniform float u_upA;       // 1: dual-filter upsample, 2: cubic B-spline upsample
uniform float u_upB;
uniform float u_ab;        // 0 = all a, 1 = all b
uniform float u_mix;
uniform float u_alpha;
${LINEAR}
${TAP}
${KAWASE_UP}
// Cubic B-spline in four bilinear fetches (Sigg & Hadwiger, GPU Gems 2 ch.
// 20). Smooth where a bilinear upsample from far below would show blocks.
vec4 bspline(sampler2D t, vec2 texel) {
  vec2 pos = vTexCoord / texel - 0.5;
  vec2 f = fract(pos);
  vec2 base = pos - f;
  vec2 w0 = (1.0 - f) * (1.0 - f) * (1.0 - f) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f * f + 3.0 * f * f * f) / 6.0;
  vec2 w3 = f * f * f / 6.0;
  vec2 w2 = 1.0 - w0 - w1 - w3;
  vec2 g0 = w0 + w1, g1 = w2 + w3;
  vec2 c0 = (base - 0.5 + w1 / g0) * texel;   // texel centres sit at +0.5
  vec2 c1 = (base + 1.5 + w3 / g1) * texel;
  float w = 0.0;
  vec4 sum = tapIn(t, vec2(c0.x, c0.y), g0.x * g0.y, w) + tapIn(t, vec2(c1.x, c0.y), g1.x * g0.y, w)
           + tapIn(t, vec2(c0.x, c1.y), g0.x * g1.y, w) + tapIn(t, vec2(c1.x, c1.y), g1.x * g1.y, w);
  return sum / w;
}

vec4 fetch(sampler2D t, vec2 texel, float up) {
  if (up > 1.5) return bspline(t, texel);
  if (up > 0.5) return kawaseUp(t, vTexCoord, texel);
  return texture2D(t, vTexCoord);
}

void main() {
  vec4 orig = texture2D(tex0, vTexCoord);
  vec4 blurred = mix(fetch(u_a, u_texelA, u_upA), fetch(u_b, u_texelB, u_upB), u_ab);
  vec3 hdr = blurred.rgb / (1.0 - u_alpha);
  vec3 col = toDisplay(hdr / (1.0 + u_alpha * max(hdr.r, max(hdr.g, hdr.b))));
  gl_FragColor = vec4(mix(orig.rgb, col, u_mix), 1.0);
}`;
