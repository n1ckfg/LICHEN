export const mosaicFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform float pixelsW;
uniform float pixelsH;

void main() {
  vec2 uv = vTexCoord;

  vec2 p = max(vec2(2.0), vec2(pixelsW, pixelsH));
  vec2 qUv = floor(uv * p) / p;

  vec4 color = texture2D(tex0, qUv);
  gl_FragColor = color;
}
`;
