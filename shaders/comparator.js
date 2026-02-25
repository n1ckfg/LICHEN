export const comparatorFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform float threshold;

void main() {
  vec4 col = texture2D(tex0, vTexCoord);
  float luma = dot(col.rgb, vec3(0.299, 0.587, 0.114));
  float val = luma > threshold ? 1.0 : 0.0;
  val = val * 0.8 + 0.1;
  gl_FragColor = vec4(val, val, val, 1.0);
}
`;
