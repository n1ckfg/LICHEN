export const tumbleFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform float uTime;
uniform sampler2D texA; // Source 1 (outgoing)
uniform sampler2D texB; // Source 2 (incoming)

void main() {
  // Tumble: video flips around horizontal or vertical axis
  vec2 uv = vTexCoord;

  // Flip animation
  float t = mod(uTime, 6.28318);
  float flip = sin(t);

  vec3 color;
  if (flip > 0.0) {
    color = texture2D(texA, uv).rgb;
  } else {
    color = texture2D(texB, uv).rgb;
  }

  gl_FragColor = vec4(color, 1.0);
}
`;
