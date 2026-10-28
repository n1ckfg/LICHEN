// LetterForms — after Vera Molnar's letter forms, tiled: a grid of one stroked
// capital, each turned a further quarter turn along the diagonals.
//
// Ported from bitcraftlab's Processing sketch `ParametrizeM.pde`, which draws
// an M. Its 500×500 canvas is fitted inside the output and centred, and
// everything here is in the canvas's own pixels (y down, as in Processing). The
// sketch strokes a polyline with round joins and caps, so a pixel is lit where
// its distance to the letter's segments is under half the stroke: the union of
// one capsule a segment, which is exactly Processing's round-jointed stroke.
// The letter's segments come from `js/modules/letterforms/alphabet.js` as a
// table. The edge is antialiased over one physical pixel (`uPixel`), so the
// pass works in `vTexCoord` and is independent of the framebuffer's pixel
// density.

export const letterformsFrag = `
precision highp float;
varying vec2 vTexCoord;

uniform vec2 uFrame;        // the output's size in canvas pixels
uniform vec2 uOrigin;       // the grid's origin on the canvas (the sketch's tx, ty)
uniform vec2 uGrid;         // columns and rows drawn
uniform float uTile;        // the tile's side (the sketch's d)
uniform float uHalfStroke;  // half the stroke width
uniform float uPixel;       // one physical pixel, in canvas pixels
uniform float uInvert;      // 0 draws black on white, 1 white on black
uniform vec4 uSegments[9];  // the letter's segments, from (x, y) to (z, w)
uniform float uSegmentCount;

#define CANVAS 500.0
#define HALF_PI 1.5707963
#define MAX_REACH 4         // tiles a stroke may reach across, each way
#define MAX_SEGMENTS 9      // alphabet.js's MAX_SEGMENTS, and uSegments' size

float segment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

// The letter form, in its own space: the tile's centre at 0, its edges at ±1
float letter(vec2 p) {
  float d = 1e9;
  for (int i = 0; i < MAX_SEGMENTS; i++) {
    if (float(i) >= uSegmentCount) break;
    d = min(d, segment(p, uSegments[i].xy, uSegments[i].zw));
  }
  return d;
}

void main() {
  // vTexCoord runs top-down inside a framebuffer, as Processing's y does
  vec2 p = (vTexCoord - 0.5) * uFrame + 0.5 * CANVAS;
  vec2 g = (p - uOrigin) / uTile;
  vec2 cell = floor(g);

  // A stroke spills past its own tile by half its width, so look at the tiles
  // around this one as far as that can reach
  float reach = min(ceil((uHalfStroke + uPixel) / uTile), float(MAX_REACH));
  float dist = 1e9;
  for (int j = -MAX_REACH; j <= MAX_REACH; j++) {
    for (int i = -MAX_REACH; i <= MAX_REACH; i++) {
      vec2 c = cell + vec2(float(i), float(j));
      if (abs(float(i)) > reach || abs(float(j)) > reach) continue;
      if (c.x < 0.0 || c.y < 0.0 || c.x >= uGrid.x || c.y >= uGrid.y) continue;
      // rotate(PI/2 * ((x + y) % 4)), undone
      float a = HALF_PI * mod(c.x + c.y, 4.0);
      float cs = cos(a);
      float sn = sin(a);
      vec2 v = (g - c) * 2.0 - 1.0;
      v = vec2(cs * v.x + sn * v.y, -sn * v.x + cs * v.y);
      dist = min(dist, letter(v));
    }
  }
  dist *= 0.5 * uTile;

  float cover = clamp((uHalfStroke - dist) / uPixel + 0.5, 0.0, 1.0);
  float fg = uInvert;
  float bg = 1.0 - uInvert;
  gl_FragColor = vec4(vec3(mix(bg, fg, cover)), 1.0);
}
`;
