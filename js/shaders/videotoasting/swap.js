export const swapFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform float uTime;
uniform sampler2D texA; // Source 1 (outgoing)
uniform sampler2D texB; // Source 2 (incoming)

#define NUM_PIECES 4

void main() {
  // Swap: video pieces cross each other
  vec2 uv = vTexCoord;
  float t = mod(uTime, 2.0);
  float progress = smoothstep(0.0, 1.0, t);

  // Horizontal pieces, alternate ones travelling in opposite directions
  float piece = floor(uv.y * float(NUM_PIECES));
  float dir = mod(piece, 2.0) < 0.5 ? 1.0 : -1.0;

  // Source 2 slides on from one side, pushing source 1 off the other
  float offset = -dir * (1.0 - progress);
  vec2 uvB = vec2(uv.x - offset, uv.y);
  vec2 uvA = vec2(uv.x - offset - dir, uv.y);

  vec3 color;
  if (uvB.x >= 0.0 && uvB.x <= 1.0) {
    color = texture2D(texB, uvB).rgb;
  } else {
    color = texture2D(texA, uvA).rgb;
  }

  gl_FragColor = vec4(color, 1.0);
}
`;
