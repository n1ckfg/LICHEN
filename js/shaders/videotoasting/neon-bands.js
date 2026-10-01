export const neonBandsFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform float uTime;
uniform sampler2D texA; // Source 1 (outgoing)
uniform sampler2D texB; // Source 2 (incoming)

#define NUM_BANDS 8

void main() {
  // NEON BANDS: Color cycling palette fade transition
  vec2 uv = vTexCoord;
  float t = mod(uTime, 2.0) * 0.5; // 0 to 1

  // Create horizontal neon bands (the Encoder graphic)
  float bandHeight = 1.0 / float(NUM_BANDS);

  vec3 neon = vec3(0.0);
  for (int i = 0; i < NUM_BANDS; i++) {
    float bandY = float(i) * bandHeight;
    float bandCenter = bandY + bandHeight * 0.5;

    // Cycle through colors based on time
    float bandOpacity = 1.0 - smoothstep(0.0, bandHeight * 0.4, abs(uv.y - bandCenter));

    // Neon colors cycling
    vec3 neonColor = vec3(
      0.5 + 0.5 * sin(uTime * 2.0 + float(i) * 0.5),
      0.5 + 0.5 * sin(uTime * 2.0 + float(i) * 0.5 + 2.0),
      0.5 + 0.5 * sin(uTime * 2.0 + float(i) * 0.5 + 4.0)
    );

    neon += bandOpacity * neonColor;
  }

  // Each band cycles from Source 1 to Source 2 in turn
  float band = floor(uv.y * float(NUM_BANDS));
  float local = clamp((t - band * bandHeight * 0.5) * 2.0, 0.0, 1.0);
  vec3 source = local < 0.5 ? texture2D(texA, uv).rgb : texture2D(texB, uv).rgb;

  // 4-level fader to the neon graphic, fully covering the source switch
  float fader = floor((1.0 - abs(local * 2.0 - 1.0)) * 3.999) / 3.0;

  gl_FragColor = vec4(mix(source, neon, fader), 1.0);
}
`;
