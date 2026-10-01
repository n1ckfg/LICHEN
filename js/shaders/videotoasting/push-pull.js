export const pushPullFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform float uTime;
uniform sampler2D texA; // Source 1 (outgoing)
uniform sampler2D texB; // Source 2 (incoming)

void main() {
  // Push/Pull: source enters from sides
  float t = mod(uTime, 2.0);
  float progress = smoothstep(0.0, 1.0, t);

  vec3 color;
  if (vTexCoord.x < progress) {
    color = texture2D(texB, vTexCoord).rgb; // Source 2 (entering)
  } else {
    color = texture2D(texA, vTexCoord).rgb; // Source 1 (leaving)
  }

  gl_FragColor = vec4(color, 1.0);
}
`;
