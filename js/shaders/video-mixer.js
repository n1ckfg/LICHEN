export const videoMixerFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform sampler2D tex1;
uniform float mix_amount;
uniform float mode;

// Helpers for the non-separable modes, as in the W3C Compositing and Blending spec
float lum(vec3 c) {
  return dot(c, vec3(0.3, 0.59, 0.11));
}

// Pull an out-of-range colour back into 0-1 along the line to its own grey,
// so its luminance is kept rather than clamping each channel on its own
vec3 clipColor(vec3 c) {
  float l = lum(c);
  float n = min(min(c.r, c.g), c.b);
  float x = max(max(c.r, c.g), c.b);
  if (n < 0.0) c = l + (c - l) * l / (l - n);
  if (x > 1.0) c = l + (c - l) * (1.0 - l) / (x - l);
  return c;
}

vec3 setLum(vec3 c, float l) {
  return clipColor(c + (l - lum(c)));
}

float sat(vec3 c) {
  return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
}

// Rescale so min -> 0 and max -> s, keeping the hue; a grey has no hue, so it goes to 0
vec3 setSat(vec3 c, float s) {
  float n = min(min(c.r, c.g), c.b);
  float x = max(max(c.r, c.g), c.b);
  return x > n ? (c - n) * s / (x - n) : vec3(0.0);
}

// B composited onto A; mix_amount is B's opacity, so Blend is a plain crossfade
vec3 composite(vec3 a, vec3 b, int m) {
  if (m == 1) return a + b;                         // Add
  if (m == 2) return a - b;                         // Subtract
  if (m == 3) return a * b;                         // Multiply
  if (m == 4) return a / max(b, 1.0 / 255.0);       // Divide (black B saturates to white)
  if (m == 5) return max(a, b);                     // Lighten
  if (m == 6) return min(a, b);                     // Darken
  if (m == 7) return abs(a - b);                    // Difference
  if (m == 8) return setLum(b, lum(a));             // Color: B's hue and saturation, A's luminance
  if (m == 9) {                                     // Overlay: multiply A's darks, screen its lights
    return mix(2.0 * a * b, 1.0 - 2.0 * (1.0 - a) * (1.0 - b), step(0.5, a));
  }
  if (m == 10) return setLum(setSat(a, sat(b)), lum(a)); // Saturation: B's saturation on A
  if (m == 11) return setLum(a, lum(b));            // Luminance: A's hue and saturation, B's luminance
  return b;                                         // Blend
}

void main() {
  vec4 col0 = texture2D(tex0, vTexCoord);
  vec4 col1 = texture2D(tex1, vTexCoord);
  vec3 blended = clamp(composite(col0.rgb, col1.rgb, int(mode + 0.5)), 0.0, 1.0);
  gl_FragColor = vec4(mix(col0.rgb, blended, mix_amount), mix(col0.a, col1.a, mix_amount));
}
`;
