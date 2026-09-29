export const videoMixerFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform sampler2D tex1;
uniform float mix_amount;
uniform float mode;

// B composited onto A; mix_amount is B's opacity, so Blend is a plain crossfade
vec3 composite(vec3 a, vec3 b, int m) {
  if (m == 1) return a + b;                         // Add
  if (m == 2) return a - b;                         // Subtract
  if (m == 3) return a * b;                         // Multiply
  if (m == 4) return a / max(b, 1.0 / 255.0);       // Divide (black B saturates to white)
  if (m == 5) return max(a, b);                     // Lighten
  if (m == 6) return min(a, b);                     // Darken
  if (m == 7) return abs(a - b);                    // Difference
  return b;                                         // Blend
}

void main() {
  vec4 col0 = texture2D(tex0, vTexCoord);
  vec4 col1 = texture2D(tex1, vTexCoord);
  vec3 blended = clamp(composite(col0.rgb, col1.rgb, int(mode + 0.5)), 0.0, 1.0);
  gl_FragColor = vec4(mix(col0.rgb, blended, mix_amount), mix(col0.a, col1.a, mix_amount));
}
`;
