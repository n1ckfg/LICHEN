// The HyperCard module's shaders.
//
// Fast: a 4x4 ordered pattern, mixed into the threshold, in one pass
export const hypercardFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform float finalThreshold;
uniform vec2 uResolution;

float getLuminance(vec3 col) {
  return dot(col, vec3(0.299, 0.587, 0.114));
}

float getDitherValue(int x, int y) {
  // 4x4 Bayer dither matrix
  if (x == 0 && y == 0) return 0.059;
  if (x == 1 && y == 0) return 0.529;
  if (x == 2 && y == 0) return 0.176;
  if (x == 3 && y == 0) return 0.647;
  if (x == 0 && y == 1) return 0.765;
  if (x == 1 && y == 1) return 0.294;
  if (x == 2 && y == 1) return 0.882;
  if (x == 3 && y == 1) return 0.412;
  if (x == 0 && y == 2) return 0.235;
  if (x == 1 && y == 2) return 0.706;
  if (x == 2 && y == 2) return 0.118;
  if (x == 3 && y == 2) return 0.588;
  if (x == 0 && y == 3) return 0.941;
  if (x == 1 && y == 3) return 0.471;
  if (x == 2 && y == 3) return 0.824;
  if (x == 3 && y == 3) return 0.353;
  return 0.0;
}

void main() {
  vec3 texColor = texture2D(tex0, vTexCoord).rgb;
  float texGray = getLuminance(texColor);

  int paletteIndex = int(texGray * 15.0);
  vec2 pixelCoord = vTexCoord * uResolution;
  int x = int(mod(pixelCoord.x, 4.0));
  int y = int(mod(pixelCoord.y, 4.0));
  float ditherVal = getDitherValue(x, y);
  int ditherIndex = int(ditherVal * 15.0);
  paletteIndex = int(min(float(paletteIndex + ditherIndex), 15.0));

  vec3 ditheredColor = vec3(
    float(paletteIndex / 4 - (paletteIndex / 8) * 2),
    float(paletteIndex / 2 - (paletteIndex / 4) * 2),
    float(paletteIndex - (paletteIndex / 2) * 2)
  );

  float texGray2 = texGray - 0.15 * getLuminance(ditheredColor);

  vec3 color;
  if (texGray2 < finalThreshold) {
    color = vec3(0.066);
  } else {
    color = vec3(0.937);
  }

  gl_FragColor = vec4(color, 1.0);
}
`;

// Accurate runs Atkinson's error diffusion exactly, on the CPU in a worker (see
// js/modules/hypercard/worker.js), so these only feed it and show what it returns.

// The input's luminance, one texel per logical pixel of the frame, into R. At
// pixel density 2 each texel's centre falls between four of the input's pixels,
// so linear filtering averages them.
export const hypercardLumaFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;

void main() {
  vec3 col = texture2D(tex0, vTexCoord).rgb;
  gl_FragColor = vec4(vec3(dot(col, vec3(0.299, 0.587, 0.114))), 1.0);
}
`;

// The dithered picture, 0 or 1 in R a pixel, sampled nearest so each logical
// pixel stays one solid block, in Fast's near-black and near-white
export const hypercardResultFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;

void main() {
  float white = texture2D(tex0, vTexCoord).r;
  gl_FragColor = vec4(vec3(mix(0.066, 0.937, step(0.5, white))), 1.0);
}
`;
