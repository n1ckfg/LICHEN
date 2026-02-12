export const colorEncoderFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform float phaseR;
uniform float phaseG;
uniform float phaseB;
uniform float frequency;

void main() {
  vec4 col = texture2D(tex0, vTexCoord);
  float luma = dot(col.rgb, vec3(0.299, 0.587, 0.114));
  float angle = luma * frequency * 6.28318530718;
  float r = 0.5 + 0.5 * sin(angle + phaseR);
  float g = 0.5 + 0.5 * sin(angle + phaseG);
  float b = 0.5 + 0.5 * sin(angle + phaseB);
  gl_FragColor = vec4(r, g, b, 1.0);
}
`;
