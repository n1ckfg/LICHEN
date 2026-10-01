export const blinds3ExpandFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform float uTime;
uniform sampler2D texA; // Source 1 (outgoing)
uniform sampler2D texB; // Source 2 (incoming)

#define NUM_BLINDS 3

void main() {
  // Blinds 3 Expand: Algorithmic 3 vertical rectangles expanding
  vec2 uv = vTexCoord;

  // Animation progress
  float t = mod(uTime, 2.0);
  float progress = smoothstep(0.0, 1.0, t);

  // Three vertical blinds
  float blindWidth = 1.0 / float(NUM_BLINDS);

  vec3 color = vec3(0.0);
  for (int i = 0; i < NUM_BLINDS; i++) {
    float blindCenterX = (float(i) + 0.5) * blindWidth;

    // Expand from center of each blind
    float distFromCenter = abs(uv.x - blindCenterX);
    float halfWidth = blindWidth * 0.5 * progress;

    if (distFromCenter < halfWidth) {
      // Inside expanding blind
      float edgeFade = 1.0 - smoothstep(halfWidth * 0.7, halfWidth, distFromCenter);

      // Alternating colors for each blind
      float m = mod(float(i), 2.0);
      if (m < 0.5) {
        color += texture2D(texA, uv).rgb * edgeFade;
      } else {
        color += texture2D(texB, uv).rgb * edgeFade;
      }
    }
  }

  gl_FragColor = vec4(color, 1.0);
}
`;
