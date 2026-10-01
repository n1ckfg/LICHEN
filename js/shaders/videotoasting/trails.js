export const trailsFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform float uTime;
uniform sampler2D texA; // Source 1 (outgoing)
uniform sampler2D texB; // Source 2 (incoming)

void main() {
  // Trails: moving video leaves trails behind
  vec2 uv = vTexCoord;

  // Create a moving object
  vec2 pos = vec2(0.5 + sin(uTime * 1.5) * 0.3, 0.5 + cos(uTime) * 0.3);
  float dist = length(uv - pos);

  // Object with trailing effect
  float obj = 1.0 - smoothstep(0.0, 0.1, dist);

  // Trail fades over time
  float trail = (1.0 - smoothstep(0.1, 0.3, dist)) * max(0.0, 1.0 - dist * 2.0);
  trail *= 0.3;

  vec3 color = mix(texture2D(texA, uv).rgb, texture2D(texB, uv).rgb, clamp(obj + trail, 0.0, 1.0));

  gl_FragColor = vec4(color, 1.0);
}
`;
