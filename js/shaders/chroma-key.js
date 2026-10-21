// ChromaKey — removes the colours near its key samples from fg and shows bg
// through the hole. Colours are compared in BT.601 YCbCr with luma at half
// weight, so shading across a backdrop, which is mostly a change of luma, costs
// less than a change of hue, while greys of different brightness stay apart.
// Each pixel finds its nearest key sample and its nearest kept sample:
//
//   alpha = ramp(dKey - tolerance)        removed within Tolerance of a key,
//                                         faded back in over Softness past it
//   alpha = max(alpha, ramp(dKey - dKeep + softness / 2))
//                                         a kept colour wins wherever it is
//                                         the nearer sample
//
// and the output is mix(bg, fg, alpha), so with no bg the hole is transparent
// black (premultiplied).

// Samples per list: the key list is the R, G, B knobs and then the colours
// added with Eyedropper +, the kept list those picked with Eyedropper −
export const CHROMA_KEY_MAX = 16;

const LUMA_WEIGHT = 0.5;
const Y = [0.299, 0.587, 0.114];
const CB = [-0.168736, -0.331264, 0.5];
const CR = [0.5, -0.418688, -0.081312];

const dot = (c, w) => c[0] * w[0] + c[1] * w[1] + c[2] * w[2];

// A sample's place in the space the shader measures in. Cb and Cr leave out
// their 0.5 offset, which cancels in a distance.
export function keySpace(rgb) {
  return [LUMA_WEIGHT * dot(rgb, Y), dot(rgb, CB), dot(rgb, CR)];
}

const vec3 = (w) => `vec3(${w.join(', ')})`;

export const chromaKeyFrag = `
precision highp float;
#define MAX_SAMPLES ${CHROMA_KEY_MAX}
varying vec2 vTexCoord;

uniform sampler2D tex0;          // fg, the picture to key
uniform sampler2D tex1;          // bg, shown where fg is removed
uniform float uHasBg;            // 0: the hole is transparent black
uniform vec3 uKeys[MAX_SAMPLES]; // colours to remove, in keySpace()
uniform float uKeyCount;
uniform vec3 uKeeps[MAX_SAMPLES]; // colours to keep, in keySpace()
uniform float uKeepCount;
uniform float uTolerance;
uniform float uSoftness;

vec3 keySpace(vec3 c) {
  return vec3(${LUMA_WEIGHT} * dot(c, ${vec3(Y)}), dot(c, ${vec3(CB)}), dot(c, ${vec3(CR)}));
}

// 0 at x <= 0, rising smoothly to 1 at x >= Softness (a step at Softness 0)
float ramp(float x) {
  float t = clamp(x / max(uSoftness, 1e-4), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

void main() {
  vec4 fg = texture2D(tex0, vTexCoord);
  vec4 bg = uHasBg > 0.5 ? texture2D(tex1, vTexCoord) : vec4(0.0);
  vec3 p = keySpace(fg.rgb);

  float dKey = 1e4;
  for (int i = 0; i < MAX_SAMPLES; i++) {
    if (float(i) >= uKeyCount) break;
    dKey = min(dKey, distance(p, uKeys[i]));
  }
  float dKeep = 1e4;
  for (int i = 0; i < MAX_SAMPLES; i++) {
    if (float(i) >= uKeepCount) break;
    dKeep = min(dKeep, distance(p, uKeeps[i]));
  }

  float alpha = ramp(dKey - uTolerance);
  alpha = max(alpha, ramp(dKey - dKeep + 0.5 * uSoftness));
  gl_FragColor = mix(bg, fg, alpha);
}
`;

// The eyedropper: the mean of the 5 x 5 logical pixels round uPick, drawn into
// a 1 x 1 framebuffer and read back, as Photoshop's 5 by 5 Average samples
export const chromaKeyPickFrag = `
precision highp float;
varying vec2 vTexCoord;

uniform sampler2D tex0;
uniform vec2 uPick; // uv, v down from the top of the picture
uniform vec2 uStep; // one logical pixel, in uv

void main() {
  vec3 sum = vec3(0.0);
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      sum += texture2D(tex0, clamp(uPick + vec2(float(x), float(y)) * uStep, 0.0, 1.0)).rgb;
    }
  }
  gl_FragColor = vec4(sum / 25.0, 1.0);
}
`;
