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
  vec4 col = texture2D(tex0, uv) * rInv / 2.0;

  vec2 flipped = zoom * (vec2(vTexCoord.x, 1.0 - vTexCoord.y) - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
  float rInvF = 1.0 / length(flipped);
  flipped = flipped * rInvF - vec2(rInvF + time * speed, 0.5);
  vec4 colF = texture2D(tex0, flipped) * rInvF / 2.0;

  gl_FragColor = max(col, colF);
}
`;
