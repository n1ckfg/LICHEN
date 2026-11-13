// Pyramidal Lucas-Kanade optical flow, after lk-optical-flow. Every buffer
// but the output is a working buffer at density 1 (see OpticalFlow Module in
// ARCHITECTURE.md).
//
// Gradients and flow are signed. In half float they are stored as they are;
// in 8 bits as v * scale + 128/255, so 128 is exactly zero. uGradEnc and
// uFlowEnc carry (scale, bias) for whichever the buffers are. Luma, which
// rides along with the gradients, is never signed and is stored as it is.

const ENCODING = `
uniform vec2 uGradEnc;
uniform vec2 uFlowEnc;
vec2 encGrad(vec2 v) { return v * uGradEnc.x + uGradEnc.y; }
vec2 decGrad(vec2 c) { return (c - uGradEnc.y) / uGradEnc.x; }
vec2 encFlow(vec2 v) { return v * uFlowEnc.x + uFlowEnc.y; }
vec2 decFlow(vec2 c) { return (c - uFlowEnc.y) / uFlowEnc.x; }
`;

// Luma of the input, blurred along uDir by a 5-tap Gaussian. The first pass
// reads the input's colour, the second the luma the first left in red.
export const opticalFlowBlurFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform vec2 uStep;   // one texel of the destination along the blur's axis
uniform float uLuma;  // 1: convert colour to luma; 0: red already holds it

float lum(vec2 uv) {
  vec3 c = texture2D(tex0, uv).rgb;
  return mix(c.r, dot(c, vec3(0.299, 0.587, 0.114)), uLuma);
}

void main() {
  float s = lum(vTexCoord - 2.0 * uStep) * 0.06136
          + lum(vTexCoord - uStep) * 0.24477
          + lum(vTexCoord) * 0.38774
          + lum(vTexCoord + uStep) * 0.24477
          + lum(vTexCoord + 2.0 * uStep) * 0.06136;
  gl_FragColor = vec4(s, s, s, 1.0);
}
`;

// One pyramid level from the one below: a 2x2 box, each tap on a texel centre
export const opticalFlowDownFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform vec2 uTexel;  // one texel of the source

void main() {
  vec2 o = uTexel * 0.5;
  float s = texture2D(tex0, vTexCoord + vec2(-o.x, -o.y)).r
          + texture2D(tex0, vTexCoord + vec2( o.x, -o.y)).r
          + texture2D(tex0, vTexCoord + vec2(-o.x,  o.y)).r
          + texture2D(tex0, vTexCoord + vec2( o.x,  o.y)).r;
  s *= 0.25;
  gl_FragColor = vec4(s, s, s, 1.0);
}
`;

// The current frame's spatial gradients at one level, central differences in
// luma per texel, with its luma in blue for the LK pass to read in the same
// fetch. They don't depend on the flow, so each level makes them once.
export const opticalFlowGradientFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;     // current frame at this level
uniform vec2 uTexel;
${ENCODING}

void main() {
  vec2 dx = vec2(uTexel.x, 0.0);
  vec2 dy = vec2(0.0, uTexel.y);
  float Ix = (texture2D(tex0, vTexCoord + dx).r - texture2D(tex0, vTexCoord - dx).r) * 0.5;
  float Iy = (texture2D(tex0, vTexCoord + dy).r - texture2D(tex0, vTexCoord - dy).r) * 0.5;
  gl_FragColor = vec4(encGrad(vec2(Ix, Iy)), texture2D(tex0, vTexCoord).r, 1.0);
}
`;

// One Lucas-Kanade step at one level (Bouguet's pyramidal LK). The window
// round each pixel of the current frame is matched against the previous
// frame shifted by the pixel's flow so far, pf, the same shift for the whole
// window. Gaussian-weighted least squares then solve A d = b, with
// A = [Ix^2, IxIy; IxIy, Iy^2] and b = -[Ix It; Iy It] divided by the
// weights' sum, and It = current - shifted previous. Where A's smaller
// eigenvalue is under uMinEigen, the window has too little texture, or
// texture in only one direction, to say how it moved, and pf stands. The
// result, pf + d, is held to +-uMaxFlow texels of this level.
export const opticalFlowLKFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;     // gradients and luma of the current frame
uniform sampler2D tex1;     // previous frame at this level
uniform sampler2D uPrior;   // the flow so far: the coarser level's, or this one's last step
uniform float uHasPrior;    // 0 for the coarsest level's first step
uniform vec2 uRatio;        // this level's size over the prior's
uniform vec2 uTexel;
uniform float uHalf;        // half the window, 1..7
uniform float uMaxFlow;
uniform float uMinEigen;
${ENCODING}

void main() {
  vec2 pf = decFlow(texture2D(uPrior, vTexCoord).xy) * uRatio * uHasPrior;
  vec2 shift = pf * uTexel;

  float A11 = 0.0, A12 = 0.0, A22 = 0.0, b1 = 0.0, b2 = 0.0, ws = 0.0;
  float fall = 1.0 / (uHalf * uHalf + 1.0);
  for (int j = -7; j <= 7; j++) {
    float fy = float(j);
    if (abs(fy) > uHalf) continue;
    for (int i = -7; i <= 7; i++) {
      float fx = float(i);
      if (abs(fx) > uHalf) continue;
      vec2 uv = vTexCoord + vec2(fx, fy) * uTexel;
      vec3 c = texture2D(tex0, uv).xyz;
      vec2 g = decGrad(c.xy);
      float It = c.z - texture2D(tex1, uv - shift).r;
      float w = exp(-(fx * fx + fy * fy) * fall);
      A11 += w * g.x * g.x;
      A12 += w * g.x * g.y;
      A22 += w * g.y * g.y;
      b1 -= w * g.x * It;
      b2 -= w * g.y * It;
      ws += w;
    }
  }
  A11 /= ws; A12 /= ws; A22 /= ws; b1 /= ws; b2 /= ws;

  float minEigen = 0.5 * (A11 + A22) - sqrt(0.25 * (A11 - A22) * (A11 - A22) + A12 * A12);
  vec2 flow = pf;
  if (minEigen > uMinEigen) {
    float det = A11 * A22 - A12 * A12;
    flow += vec2(A22 * b1 - A12 * b2, A11 * b2 - A12 * b1) / det;
  }
  flow = clamp(flow, vec2(-uMaxFlow), vec2(uMaxFlow));
  gl_FragColor = vec4(encFlow(flow), 0.0, 1.0);
}
`;

// Level 0's flow mixed with last frame's result, for temporal smoothing
export const opticalFlowSmoothFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;     // this frame's flow
uniform sampler2D tex1;     // last frame's smoothed flow
uniform float uSmooth;
${ENCODING}

void main() {
  vec2 now = decFlow(texture2D(tex0, vTexCoord).xy);
  vec2 last = decFlow(texture2D(tex1, vTexCoord).xy);
  gl_FragColor = vec4(encFlow(mix(now, last, uSmooth)), 0.0, 1.0);
}
`;

// The output. Flow is in pixels of the logical frame, +x right and +y down.
//   0 Color      hue by direction, saturation by speed (full at Range)
//   1 Magnitude  a heat ramp of speed
//   2 Arrows     one arrow a cell over the input, coloured as Color
//   3 Warp       the previous frame pulled along the flow, over the current
//   4 Vectors    x in red and y in green as Displacer reads them: 128 is
//                still, 0 and 255 are -Range and +Range
export const opticalFlowViewFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;     // input
uniform sampler2D tex1;     // previous input
uniform sampler2D uFlow;
uniform vec2 uSize;         // logical frame
uniform float uDensity;
uniform float uView;
uniform float uRange;
uniform float uSpacing;
${ENCODING}

const float PI = 3.14159265;

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

vec2 flowAt(vec2 uv) {
  return decFlow(texture2D(uFlow, uv).xy);
}

float hueOf(vec2 f) {
  return (atan(f.y, f.x) + PI) / (2.0 * PI);
}

float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  return length(p - a - ab * t);
}

// Arrows: each cell's arrow starts at its centre and is at most two cells
// long, so the cells within two of this one are all that can reach it
vec4 arrows(vec2 p) {
  float scale = 2.0 * uSpacing / uRange;
  float maxLen = 2.0 * uSpacing;
  float aa = 1.0 / uDensity;
  vec2 cell = floor(p / uSpacing);
  float cover = 0.0;
  vec3 col = vec3(0.0);
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      vec2 c = (cell + vec2(float(i), float(j)) + 0.5) * uSpacing;
      if (c.x > uSize.x || c.y > uSize.y || c.x < 0.0 || c.y < 0.0) continue;
      vec2 f = flowAt(c / uSize);
      float mag = length(f);
      if (mag <= 0.5) continue;
      vec2 dir = f / mag;
      float len = min(mag * scale, maxLen);
      vec2 e = c + dir * len;
      float hl = min(len * 0.2, 6.0);
      vec2 back = -dir;
      vec2 h1 = e + hl * vec2(back.x * cos(0.5) - back.y * sin(0.5), back.x * sin(0.5) + back.y * cos(0.5));
      vec2 h2 = e + hl * vec2(back.x * cos(0.5) + back.y * sin(0.5), -back.x * sin(0.5) + back.y * cos(0.5));
      float d = min(segDist(p, c, e), min(segDist(p, e, h1), segDist(p, e, h2)));
      float a = 1.0 - smoothstep(0.75 - aa * 0.5, 0.75 + aa * 0.5, d);
      if (a > cover) {
        cover = a;
        col = hsv2rgb(vec3(hueOf(f), clamp(mag / uRange, 0.4, 1.0), 1.0));
      }
    }
  }
  return vec4(col, cover);
}

void main() {
  vec2 f = flowAt(vTexCoord);
  float mag = length(f);
  vec3 rgb;

  if (uView < 0.5) {
    rgb = hsv2rgb(vec3(hueOf(f), min(mag / uRange, 1.0), min(0.5 + mag / (2.0 * uRange), 1.0)));
  } else if (uView < 1.5) {
    float m = min(mag / uRange, 1.0);
    rgb = vec3(m, m * 0.5, m * 0.2);
  } else if (uView < 2.5) {
    vec4 a = arrows(vTexCoord * uSize);
    rgb = mix(texture2D(tex0, vTexCoord).rgb, a.rgb, a.a);
  } else if (uView < 3.5) {
    vec3 warped = texture2D(tex1, clamp(vTexCoord - f / uSize, 0.0, 1.0)).rgb;
    rgb = mix(warped, texture2D(tex0, vTexCoord).rgb, 0.35);
  } else {
    vec2 v = clamp(f / uRange, -1.0, 127.0 / 128.0);
    rgb = vec3((128.0 + 128.0 * v) / 255.0, 128.0 / 255.0);
  }
  gl_FragColor = vec4(rgb, 1.0);
}
`;
