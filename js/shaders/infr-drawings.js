// InfrDrawings' input: the frame shrunk to the model's 320 x 240, each pixel
// the mean of the input pixels it covers. Each tap sits where four input
// pixels meet, so bilinear filtering averages them, and uTaps x uTaps taps
// cover a cell 2 uTaps input pixels a side: one tap at pixel density 1, where
// a cell is 2 x 2, and 2 x 2 at density 2. A tap at the centre alone would
// alias fine detail, which the model draws as lines.
export const infrDrawingsInputFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform vec2 uCell;          // one model pixel, in uv
uniform float uTaps;         // taps across it, 1-8

void main() {
  vec3 sum = vec3(0.0);
  for (int j = 0; j < 8; j++) {
    if (float(j) >= uTaps) break;
    for (int i = 0; i < 8; i++) {
      if (float(i) >= uTaps) break;
      vec2 o = (vec2(float(i), float(j)) + 0.5) / uTaps - 0.5;
      sum += texture2D(tex0, vTexCoord + o * uCell).rgb;
    }
  }
  gl_FragColor = vec4(sum / (uTaps * uTaps), 1.0);
}
`;
