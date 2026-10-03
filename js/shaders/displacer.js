// Displacer — After Effects' Displacement Map. Each output pixel reads one
// channel of the map at its own position, turns it into a signed amount, and
// samples the input that many pixels away:
//
//   out(x, y) = in(x + dx * xMax, y + dy * yMax),   d = (255 v - 128) / 128
//
// so a map value of 0 is the full negative shift, 128 none, and 255 the full
// positive one. Sampling ahead moves the picture the other way: where the map
// is white and X Max is positive, the image slides left, and with Y Max
// positive it slides up. Offsets are in pixels of the logical frame (640 x 480)
// and applied in uv space, so they don't depend on the pixel density.
export const displacerFrag = `
precision highp float;
varying vec2 vTexCoord;

uniform sampler2D tex0;     // the video to displace
uniform sampler2D tex1;     // the displacement map
uniform vec2 uResolution;   // logical frame size, for pixels -> uv
uniform float uXChannel;    // which map channel drives each axis (see amount())
uniform float uYChannel;
uniform vec2 uMax;          // max displacement in pixels, x then y
uniform float uEdges;       // 0 clamp, 1 wrap, 2 mirror, 3 black

float hue(vec3 c) {
  float x = max(max(c.r, c.g), c.b);
  float n = min(min(c.r, c.g), c.b);
  float d = x - n;
  if (d <= 0.0) return 0.0;
  float h;
  if (x == c.r) h = (c.g - c.b) / d;
  else if (x == c.g) h = 2.0 + (c.b - c.r) / d;
  else h = 4.0 + (c.r - c.g) / d;
  return fract(h / 6.0);
}

float lightness(vec3 c) {
  return 0.5 * (max(max(c.r, c.g), c.b) + min(min(c.r, c.g), c.b));
}

// HSL saturation, to go with Hue and Lightness
float saturation(vec3 c) {
  float x = max(max(c.r, c.g), c.b);
  float n = min(min(c.r, c.g), c.b);
  float l = 0.5 * (x + n);
  float k = 1.0 - abs(2.0 * l - 1.0);
  return k > 0.0 ? (x - n) / k : 0.0;
}

// The signed amount, -1 to 1, that one map pixel gives an axis. Options follow
// After Effects' "Use For" menu, in its order.
float amount(vec4 m, float ch) {
  float v;
  if (ch < 0.5) v = m.r;
  else if (ch < 1.5) v = m.g;
  else if (ch < 2.5) v = m.b;
  else if (ch < 3.5) v = m.a;
  else if (ch < 4.5) v = dot(m.rgb, vec3(0.299, 0.587, 0.114));
  else if (ch < 5.5) v = hue(m.rgb);
  else if (ch < 6.5) v = lightness(m.rgb);
  else if (ch < 7.5) v = saturation(m.rgb);
  else if (ch < 8.5) return 1.0;   // Full
  else return 0.0;                 // Half, Off
  return (255.0 * v - 128.0) / 128.0;
}

void main() {
  vec4 m = texture2D(tex1, vTexCoord);
  vec2 d = vec2(amount(m, uXChannel), amount(m, uYChannel));
  // vTexCoord runs top-down inside a framebuffer, so +v is down, as in AE
  vec2 uv = vTexCoord + d * uMax / uResolution;

  if (uEdges < 0.5) {
    uv = clamp(uv, 0.0, 1.0);
  } else if (uEdges < 1.5) {
    uv = fract(uv);
  } else if (uEdges < 2.5) {
    uv = 1.0 - abs(1.0 - mod(uv, 2.0));
  } else if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  gl_FragColor = texture2D(tex0, uv);
}
`;
