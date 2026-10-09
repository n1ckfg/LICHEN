// Pix2Pix's output: the model's drawing, scaled up from 256 x 256 to the
// canvas, which stretches it back to the frame's shape. Invert inverts it.
// Color keeps the lines and multiplies them by the input, so each line takes
// the colour of the picture under it on black, whether the model draws its
// lines dark on light or light on dark.
export const pix2pixOutputFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;      // the drawing
uniform sampler2D texIn;     // the input, read only by Color
uniform float uMode;         // 0 Default, 1 Invert, 2 Color
uniform float uLight;        // 1 if the model draws light lines on dark

void main() {
  vec3 drawn = texture2D(tex0, vTexCoord).rgb;
  vec3 c = uMode > 0.5 && uMode < 1.5 ? 1.0 - drawn : drawn;
  if (uMode > 1.5) c = (uLight > 0.5 ? drawn : 1.0 - drawn) * texture2D(texIn, vTexCoord).rgb;
  gl_FragColor = vec4(c, 1.0);
}
`;
