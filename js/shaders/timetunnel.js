export const timetunnelFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform float time;
uniform vec2 uResolution;
uniform float zoom;
uniform float speed;

void main() {
  vec2 uv = zoom * (vTexCoord - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
  float rInv = 1.0 / length(uv);
  uv = uv * rInv - vec2(rInv + time * speed, 0.5);
  gl_FragColor = texture2D(tex0, uv) * rInv / 2.0;
}
`;
