// The Color drop-down. Grey (uGrey = 1) dithers luminance, carried in all three
// channels, so each channel lands on the same step; RGB dithers each channel as is.
const colorMode = `
uniform float uGrey;

vec3 colorMode(vec3 col) {
  return uGrey > 0.5 ? vec3(dot(col, vec3(0.299, 0.587, 0.114))) : col;
}
`;

export const ditherFrag = `
precision mediump float;

uniform sampler2D tex0;
uniform float levels;
uniform float ditherStrength;
uniform float mode;
uniform vec2 uResolution;

varying vec2 vTexCoord;
${colorMode}
// 8x8 Bayer matrix for ordered dithering
float getBayerValue(int x, int y) {
  int index = x + y * 8;

  if (index == 0) return 0.0/64.0;
  if (index == 1) return 32.0/64.0;
  if (index == 2) return 8.0/64.0;
  if (index == 3) return 40.0/64.0;
  if (index == 4) return 2.0/64.0;
  if (index == 5) return 34.0/64.0;
  if (index == 6) return 10.0/64.0;
  if (index == 7) return 42.0/64.0;

  if (index == 8) return 48.0/64.0;
  if (index == 9) return 16.0/64.0;
  if (index == 10) return 56.0/64.0;
  if (index == 11) return 24.0/64.0;
  if (index == 12) return 50.0/64.0;
  if (index == 13) return 18.0/64.0;
  if (index == 14) return 58.0/64.0;
  if (index == 15) return 26.0/64.0;

  if (index == 16) return 12.0/64.0;
  if (index == 17) return 44.0/64.0;
  if (index == 18) return 4.0/64.0;
  if (index == 19) return 36.0/64.0;
  if (index == 20) return 14.0/64.0;
  if (index == 21) return 46.0/64.0;
  if (index == 22) return 6.0/64.0;
  if (index == 23) return 38.0/64.0;

  if (index == 24) return 60.0/64.0;
  if (index == 25) return 28.0/64.0;
  if (index == 26) return 52.0/64.0;
  if (index == 27) return 20.0/64.0;
  if (index == 28) return 62.0/64.0;
  if (index == 29) return 30.0/64.0;
  if (index == 30) return 54.0/64.0;
  if (index == 31) return 22.0/64.0;

  if (index == 32) return 3.0/64.0;
  if (index == 33) return 35.0/64.0;
  if (index == 34) return 11.0/64.0;
  if (index == 35) return 43.0/64.0;
  if (index == 36) return 1.0/64.0;
  if (index == 37) return 33.0/64.0;
  if (index == 38) return 9.0/64.0;
  if (index == 39) return 41.0/64.0;

  if (index == 40) return 51.0/64.0;
  if (index == 41) return 19.0/64.0;
  if (index == 42) return 59.0/64.0;
  if (index == 43) return 27.0/64.0;
  if (index == 44) return 49.0/64.0;
  if (index == 45) return 17.0/64.0;
  if (index == 46) return 57.0/64.0;
  if (index == 47) return 25.0/64.0;

  if (index == 48) return 15.0/64.0;
  if (index == 49) return 47.0/64.0;
  if (index == 50) return 7.0/64.0;
  if (index == 51) return 39.0/64.0;
  if (index == 52) return 13.0/64.0;
  if (index == 53) return 45.0/64.0;
  if (index == 54) return 5.0/64.0;
  if (index == 55) return 37.0/64.0;

  if (index == 56) return 63.0/64.0;
  if (index == 57) return 31.0/64.0;
  if (index == 58) return 55.0/64.0;
  if (index == 59) return 23.0/64.0;
  if (index == 60) return 61.0/64.0;
  if (index == 61) return 29.0/64.0;
  if (index == 62) return 53.0/64.0;
  if (index == 63) return 21.0/64.0;

  return 0.0;
}

// Hash functions for blue noise generation
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Interleaved gradient noise - approximates blue noise properties
float interleavedGradientNoise(vec2 p) {
  vec3 magic = vec3(0.06711056, 0.00583715, 52.9829189);
  return fract(magic.z * fract(dot(p, magic.xy)));
}

// Blue noise approximation using multiple octaves
float blueNoise(vec2 p) {
  float n = interleavedGradientNoise(p);
  n += 0.5 * interleavedGradientNoise(p * 2.0 + 0.5);
  n += 0.25 * interleavedGradientNoise(p * 4.0 + 1.0);
  return fract(n);
}

vec3 closestStep(vec3 value, float numSteps) {
  return floor(value * numSteps + 0.5) / numSteps;
}

void main() {
  vec2 uv = vTexCoord.xy;
  vec3 texColor = colorMode(texture2D(tex0, uv).rgb);

  vec2 pixelCoord = gl_FragCoord.xy;
  float numSteps = max(levels - 1.0, 1.0);
  float threshold;

  if (mode < 0.5) {
    // Mode 0: Bayer ordered dithering
    int x = int(mod(pixelCoord.x, 8.0));
    int y = int(mod(pixelCoord.y, 8.0));
    threshold = getBayerValue(x, y) - 0.5;
  } else {
    // Mode 1: Blue noise dithering
    threshold = blueNoise(pixelCoord) - 0.5;
  }

  // Each channel is quantized on its own against the same threshold, so a grey
  // input stays grey, dithered exactly as a single channel would be.
  vec3 dithered = texColor + threshold * ditherStrength / numSteps;
  vec3 quantized = closestStep(clamp(dithered, 0.0, 1.0), numSteps);

  gl_FragColor = vec4(quantized, 1.0);
}
`;

// Error diffusion runs every pixel in parallel, each pass gathering its neighbours'
// error from the pass before. Left alone, a flat area gathers the same error at every
// pixel, so the whole area makes the same choice and flips between black and white
// from pass to pass. A fixed per-pixel threshold offset makes neighbours decide
// differently. Its strength (up to +-0.625 of a step) was tuned by measurement: weaker
// lets flat areas lock step, stronger drowns the error feedback in noise.
const errorThresholdNoise = `
const float THRESHOLD_NOISE = 1.25;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float thresholdOffset(float numSteps) {
  return (hash(gl_FragCoord.xy) - 0.5) * THRESHOLD_NOISE / numSteps;
}
`;

// Error diffusion shader - initial pass: quantize and calculate error
export const ditherErrorInitFrag = `
precision highp float;

uniform sampler2D tex0;
uniform float levels;
uniform vec2 uResolution;

varying vec2 vTexCoord;
${colorMode}
vec3 closestStep(vec3 value, float numSteps) {
  return floor(value * numSteps + 0.5) / numSteps;
}
${errorThresholdNoise}
void main() {
  vec2 uv = vTexCoord.xy;
  vec3 texColor = colorMode(texture2D(tex0, uv).rgb);

  float numSteps = max(levels - 1.0, 1.0);
  vec3 quantized = closestStep(clamp(texColor + thresholdOffset(numSteps), 0.0, 1.0), numSteps);
  vec3 error = texColor - quantized;

  // Store: RGB = each channel's error (shifted to 0-1 range)
  gl_FragColor = vec4(error * 0.5 + 0.5, 1.0);
}
`;

// Error diffusion shader - diffusion pass: spread error to neighbors.
// Every pass but the last stores each channel's new error, as the init pass does;
// the last (uFinal = 1) writes the quantized colour instead.
export const ditherErrorDiffuseFrag = `
precision highp float;

uniform sampler2D tex0;
uniform sampler2D texOriginal;
uniform float levels;
uniform float ditherStrength;
uniform vec2 uResolution;
uniform float passIndex;
uniform float uFinal;

varying vec2 vTexCoord;
${colorMode}
vec3 closestStep(vec3 value, float numSteps) {
  return floor(value * numSteps + 0.5) / numSteps;
}

vec3 errorAt(vec2 uv) {
  return (texture2D(tex0, uv).rgb - 0.5) * 2.0;
}
${errorThresholdNoise}
void main() {
  vec2 uv = vTexCoord.xy;
  vec2 texel = 1.0 / uResolution;

  // Get original colour
  vec3 origColor = colorMode(texture2D(texOriginal, uv).rgb);

  // Gather error from neighbors (Floyd-Steinberg weights, reversed for gathering)
  // We gather from pixels that would have diffused TO us
  vec3 errorFromLeft = errorAt(uv - vec2(texel.x, 0.0));
  vec3 errorFromTopRight = errorAt(uv + vec2(texel.x, -texel.y));
  vec3 errorFromTop = errorAt(uv - vec2(0.0, texel.y));
  vec3 errorFromTopLeft = errorAt(uv - vec2(texel.x, texel.y));

  // Floyd-Steinberg weights: 7/16, 3/16, 5/16, 1/16
  vec3 gatheredError = errorFromLeft * (7.0/16.0) +
                       errorFromTopLeft * (3.0/16.0) +
                       errorFromTop * (5.0/16.0) +
                       errorFromTopRight * (1.0/16.0);

  // Apply gathered error to original value and re-quantize
  float numSteps = max(levels - 1.0, 1.0);
  vec3 adjusted = origColor + gatheredError * ditherStrength;
  vec3 newQuantized = closestStep(clamp(adjusted + thresholdOffset(numSteps), 0.0, 1.0), numSteps);
  vec3 newError = adjusted - newQuantized;

  gl_FragColor = uFinal > 0.5 ? vec4(newQuantized, 1.0) : vec4(newError * 0.5 + 0.5, 1.0);
}
`;
