export const resizeFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;

void main() {
  // The input texture's own bilinear filter does the scaling
  gl_FragColor = texture2D(tex0, vTexCoord);
}
`;
