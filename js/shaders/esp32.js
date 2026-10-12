// The OLED panel of the Death Star Plans port: each of the display's pixels,
// 128 x 64 of them in the port, as a slightly inset rounded square, with a halo from the lit pixels
// round it and a white-hot core where they are dense. The port worked in
// gl_FragCoord; this works in vTexCoord, where v = 0 is already the top row,
// so it is the same at any pixel density.
export const esp32Frag = `
precision highp float;

varying vec2 vTexCoord;

uniform sampler2D uTex;   // the display, a texel a pixel: a lit one is 1 in red
uniform vec2 uRes;        // the display's size in pixels
uniform vec2 uFrame;      // the output's size, in px of the logical frame
uniform vec4 uRect;       // the panel in those px (x, y, w, h), from the top-left
uniform float uCellPx;    // a display pixel's size, in real pixels
uniform vec3 uColor;
uniform float uGrid;      // visibility of unlit pixel cells

float lit(vec2 cell) {
  if (cell.x < 0.0 || cell.y < 0.0 || cell.x >= uRes.x || cell.y >= uRes.y) return 0.0;
  return texture2D(uTex, (cell + 0.5) / uRes).r;
}

void main() {
  vec2 pix = (vTexCoord * uFrame - uRect.xy) / uRect.zw * uRes;   // row 0 at the top, like the OLED
  vec2 cell = floor(pix);
  vec2 f = pix - cell;
  // Past the halo's three cells round the panel nothing is lit, which is half
  // the frame, so those fragments skip the halo's 49 taps
  if (cell.x < -3.0 || cell.y < -3.0 || cell.x >= uRes.x + 3.0 || cell.y >= uRes.y + 3.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  float aa = 1.0 / max(uCellPx, 1.0);

  // pixel cell shape: slightly inset rounded square
  vec2 d = abs(f - 0.5);
  float inset = uCellPx > 3.0 ? 0.42 : 0.5;
  float r = 0.12;
  vec2 q = max(d - (inset - r), 0.0);
  float sdf = length(q) - r;
  float shape = 1.0 - smoothstep(-aa, aa, sdf);

  float inside = step(0.0, cell.x) * step(0.0, cell.y) * step(cell.x, uRes.x - 1.0) * step(cell.y, uRes.y - 1.0);
  float on = lit(cell);

  // halo from neighbouring lit pixels
  float glow = 0.0;
  for (int j = -3; j <= 3; j++)
    for (int i = -3; i <= 3; i++) {
      vec2 c = cell + vec2(float(i), float(j));
      vec2 dv = pix - (c + 0.5);
      glow += lit(c) * exp(-dot(dv, dv) * 0.55);
    }

  vec3 col = uColor * (on * shape * 1.15 + glow * 0.16);
  col += uColor * uGrid * 0.035 * shape * inside * (1.0 - on);
  // white-hot core where pixels are dense
  col += vec3(1.0) * smoothstep(1.2, 4.0, glow) * 0.18 * shape * on;
  gl_FragColor = vec4(col, 1.0);
}
`;
