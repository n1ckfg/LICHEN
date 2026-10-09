// InfrDrawings' input: the frame shrunk to the model's size, each pixel the
// mean of the input pixels it covers. Each tap sits where four input pixels
// meet, so bilinear filtering averages them, and uTaps x uTaps taps cover a
// cell 2 uTaps input pixels a side. For 320 x 240 that is one tap at pixel
// density 1, where a cell is 2 x 2, and 2 x 2 at density 2. Where a cell is a
// single input pixel (640 x 480 at density 1), the one tap sits on its centre
// and reads it exactly. A tap at the centre alone would alias fine detail,
// which the model draws as lines.
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

// InfrDrawings' output: the model's drawing, dark lines on white, scaled up to
// the canvas. Invert turns it to white lines on black, and Color multiplies
// that by the input, so each line takes the colour of the picture under it.
export const infrDrawingsOutputFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;      // the drawing
uniform sampler2D texIn;     // the input, read only by Color
uniform float uMode;         // 0 Default, 1 Invert, 2 Color

void main() {
  vec3 line = texture2D(tex0, vTexCoord).rgb;
  if (uMode > 0.5) line = 1.0 - line;
  if (uMode > 1.5) line *= texture2D(texIn, vTexCoord).rgb;
  gl_FragColor = vec4(line, 1.0);
}
`;
