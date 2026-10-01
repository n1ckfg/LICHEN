export const blindsFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform float uTime;
uniform sampler2D texA; // Source 1 (outgoing)
uniform sampler2D texB; // Source 2 (incoming)

#define NUM_BLINDS 6

void main() {
  // Blinds effect: vertical slats compressing/expanding
  float t = mod(uTime, 2.0); // 0 to 2

  vec2 uv = vTexCoord;
  vec3 color = vec3(0.0);

  for (int i = 0; i < NUM_BLINDS; i++) {
    float pos = float(i) / float(NUM_BLINDS);
    float nextPos = float(i + 1) / float(NUM_BLINDS);
    float w = nextPos - pos;

    // Calculate blind motion - compress to center then expand
    float compressedWidth = w * (1.0 - t * 0.45);
    float centerOffset = (pos + nextPos) / 2.0 - 0.5;
    float blindStart = pos + centerOffset * t;

    if (uv.x >= blindStart && uv.x < blindStart + compressedWidth) {
      // Inside this blind - show alternating colors
      float m = mod(float(i), 2.0);
      color = m < 0.5 ? texture2D(texA, uv).rgb : texture2D(texB, uv).rgb;
    }
  }

  gl_FragColor = vec4(color, 1.0);
}
`;
