export const mosaicFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform float pixels;

void main() {
  vec2 uv = vTexCoord;

  float p = max(2.0, pixels);
  vec2 qUv = floor(uv * p) / p;

  vec4 color = texture2D(tex0, qUv);
  gl_FragColor = color;
}
`;
