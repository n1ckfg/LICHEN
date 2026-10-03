// SlowscanJam's shaders: a downsample of the input into the encoder's source
// picture, the WebGLPhosphor scanlines redone for p5, and the phosphor fade.

// Shrinks the input to the encoder's source picture (SSJ_SOURCE_W x lines) with
// a 4 x 4 box of bilinear taps per output texel, so detail between taps doesn't
// alias. The SlowscanJam app's source was its 320 x 150 camera canvas.
export const slowscanjamDownsampleFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform vec2 uStep;   // one output texel, in uv

void main() {
  vec3 acc = vec3(0.0);
  for (int j = 0; j < 4; j++) {
    for (int i = 0; i < 4; i++) {
      vec2 o = (vec2(float(i), float(j)) + 0.5) / 4.0 - 0.5;
      acc += texture2D(tex0, vTexCoord + o * uStep).rgb;
    }
  }
  gl_FragColor = vec4(acc / 16.0, 1.0);
}
`;

// Lines go in batches of SSJ_BATCH quads, one per decoded scanline, drawn from
// one p5.Geometry: aPosition.x runs -1..1 along the line, aPosition.y across
// it, and aPosition.z is the quad's index. Each line's ends and height come in
// uLines, laid out in pixels of the logical frame with y down, as the original
// canvas was. Its samples are a row of uYcc.
//
// The original drew a triangle strip with a vertex pair per sample, converting
// each sample to RGB in the vertex shader and letting the rasterizer blend
// neighbours. One quad that converts the two samples either side of each
// fragment and blends them the same way covers the same pixels with the same
// colour, without instancing, which p5 doesn't have.
export const SSJ_BATCH = 64;

export const slowscanjamLineVert = `
precision highp float;
attribute vec3 aPosition;

uniform vec4 uLines[${SSJ_BATCH}];   // x start, x end, y, last sample index
uniform float uCount;                 // lines in this batch
uniform float uRowBase;               // uYcc row of quad 0
uniform vec2 uRes;                    // logical frame size
uniform float uHalfWidth;

varying float vSample;   // position along the line, in samples
varying float vLast;
varying float vRow;

void main() {
  if (aPosition.z >= uCount) {
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);   // spare quad: off screen
    return;
  }
  vec4 line = uLines[int(aPosition.z)];
  float t = aPosition.x * 0.5 + 0.5;
  vec2 pos = vec2(mix(line.x, line.y, t), line.z + aPosition.y * uHalfWidth);
  // gl_FragCoord.y = 0 is the top of a framebuffer, so y down needs no flip
  gl_Position = vec4(pos / uRes * 2.0 - 1.0, 0.0, 1.0);
  vSample = t * line.w;
  vLast = line.w;
  vRow = uRowBase + aPosition.z;
}
`;

export const slowscanjamLineFrag = `
precision highp float;
uniform sampler2D uYcc;   // one row per line: normalized (Y, Cb, Cr) per sample
uniform vec2 uTexSize;
uniform float uBrightness;
uniform float uSaturation;

varying float vSample;
varying float vLast;
varying float vRow;

// WebGLPhosphor's toRGB(), with its integer-ratio coefficients
vec3 toRGB(vec3 ycc) {
  float y = ycc.x * uBrightness * 255.0;
  float cb = ycc.y * uSaturation * 255.0 - 128.0;
  float cr = ycc.z * uSaturation * 255.0 - 128.0;
  vec3 rgb = vec3(y + 45.0 * cr / 32.0,
                  y - (11.0 * cb + 23.0 * cr) / 32.0,
                  y + 113.0 * cb / 64.0);
  return clamp(rgb, 0.0, 255.0) * (1.0 / 255.0);
}

vec3 sampleAt(float i) {
  return toRGB(texture2D(uYcc, (vec2(i, vRow) + 0.5) / uTexSize).xyz);
}

void main() {
  float s = clamp(vSample, 0.0, vLast);
  float i0 = min(floor(s), vLast - 1.0);
  gl_FragColor = vec4(mix(sampleAt(i0), sampleAt(i0 + 1.0), s - i0), 1.0);
}
`;

// A black quad at uAlpha, over the frame under p5's BLEND, as WebGLPhosphor's fade()
export const slowscanjamFadeFrag = `
precision highp float;
uniform float uAlpha;
void main() {
  gl_FragColor = vec4(0.0, 0.0, 0.0, uAlpha);
}
`;
