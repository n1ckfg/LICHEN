export const videoMixerFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform sampler2D tex1;
uniform float mix_amount;

void main() {
  vec4 col0 = texture2D(tex0, vTexCoord);
  vec4 col1 = texture2D(tex1, vTexCoord);
  gl_FragColor = mix(col0, col1, mix_amount);
}
`;
