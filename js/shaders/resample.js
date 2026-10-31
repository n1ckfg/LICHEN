export const resampleFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform vec2 uScale;   // output size / picture size, per axis

void main() {
  // The picture is centred; past its edges are opaque black bars
  vec2 uv = (vTexCoord - 0.5) * uScale + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  // The input texture's own bilinear filter does the scaling
  gl_FragColor = texture2D(tex0, uv);
}
`;
