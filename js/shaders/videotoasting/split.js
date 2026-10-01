export const splitFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform float uTime;
uniform sampler2D texA; // Source 1 (outgoing)
uniform sampler2D texB; // Source 2 (incoming)

void main() {
  // Split: video divided in two pieces
  float splitPos = 0.5 + sin(uTime) * 0.3;
  float gap = 0.02 + sin(uTime * 3.0) * 0.01;

  vec3 color;
  if (vTexCoord.x < splitPos - gap * 0.5) {
    color = texture2D(texA, vTexCoord).rgb; // Left side (source 1)
  } else if (vTexCoord.x > splitPos + gap * 0.5) {
    color = texture2D(texB, vTexCoord).rgb; // Right side (source 2)
  } else {
    color = vec3(0.1, 0.1, 0.1); // Gap (dark)
  }

  gl_FragColor = vec4(color, 1.0);
}
`;
