// Whitney: five Processing sketches of John Whitney's incremental drift, drawn as
// one batch of quads. aPosition.xy is the quad's corner (-1..1) and aPosition.z its
// index: quad 0 is the Music Box's grey line, quad q > 0 is dot q - 1.
//
// Each sketch places its dots in its own canvas ("design" pixels, y down), exactly
// as the original computes them; uScale/uBias fit that canvas into the output. The
// clock arrives as cycle fractions already reduced in JS (uState), because the
// angles themselves run far past float precision: WhitneyScope's sin(a * timer)
// reaches about 10^7 radians.
export const whitneyVert = `
precision highp float;

attribute vec3 aPosition;

uniform float uMode;
uniform float uCount;      // dots in this sketch
uniform vec4 uState;       // per-sketch clock, see WhitneyModule.js
uniform float uSince[48];  // Music Box: ms since each dot crossed the line
uniform vec2 uScale;       // design px -> clip
uniform vec2 uBias;
uniform float uPxPerUnit;  // physical output px per design px
uniform float uSize;

varying vec2 vCorner;
varying float vRadPx;
varying vec3 vColor;
varying float vLine;

const float TAU = 6.28318530718;

// Processing's colorMode(HSB, 1)
vec3 hsb(float h, float s, float b) {
  vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return b * mix(vec3(1.0), rgb, s);
}

// whitney_I: 48 dots, the outermost slowest. A dot flashes white and swells as it
// crosses the line, where the original sounds its note.
void musicBox(float i, out vec2 c, out float d, out vec3 col) {
  float n = i + 1.0;
  float r = n / 48.0;
  float a = TAU * fract(uState.x * n);
  float len = 237.5 * (1.0 + 1.0 / 48.0 - r);
  c = vec2(250.0) + vec2(cos(a), sin(a)) * len;
  float since = uSince[int(i)];
  float minRad = 20.0 - r * 16.0;
  d = max(minRad + 6.0 - 6.0 * since / 500.0, minRad);
  col = hsb(r, min(0.5, since / 1000.0), 1.0);
}

// whitney_II: uState = (fract(timer / 2piN), fract(timer^2 / 2piN), fract(timer * .01), flip)
void scope(float i, out vec2 c, out float d, out vec3 col) {
  float k = uState.w > 0.5 ? 400.0 - i : i;
  float r = k / 400.0;
  float a = TAU * fract(k * uState.x);
  float len = i * 285.0 / 400.0;
  d = max(2.0, len * 0.05);
  len *= sin(TAU * fract(k * uState.y));
  c = floor(vec2(300.0) + vec2(cos(a), sin(a)) * len);
  col = hsb(fract(r + uState.z), 0.5, 1.0 - r / 2.0);
}

// whitney_III: uState.x = (step * r) mod round(r). Each dot slides along x by i * step * r,
// wrapped into a band 3 radii wide.
void arabesque(float i, out vec2 c, out float d, out vec3 col) {
  const float RADIUS = 211.2;
  const float R = 3.0 * RADIUS;
  const float RR = 634.0;  // Math.round(R)
  float ratio = i / 360.0;
  float a = radians(-90.0 + 360.0 * ratio);
  float x = cos(a) * ratio + mod(i * uState.x, RR);
  c = floor(vec2(320.0 - R / 2.0 + mod(floor(x + R / 2.0), RR), 240.0 + sin(a) * RADIUS));
  d = 4.0;
  col = vec3(1.0);
}

// whitney_IV: uState.x = 170 * fract(step). Dot p climbs p * step lengths of the column.
void columnA(float p, out vec2 c, out float d, out vec3 col) {
  c = vec2(floor(38.0 + 170.0 * p / 60.0), 18.0 + mod(floor(p * uState.x + 0.5), 170.0));
  d = 4.0;
  col = vec3(1.0);
}

// whitney_V: uState.x = fract(step). Dot i turns i * step times round the centre.
void columnBC(float i, out vec2 c, out float d, out vec3 col) {
  float a = TAU * fract(i * uState.x);
  vec2 p = floor(vec2(250.0) + vec2(cos(a), sin(a)) * (i / 360.0) * 225.0);
  c = vec2(p.x, 500.0 - p.y);
  d = 4.0;
  col = vec3(1.0);
}

void main() {
  float q = aPosition.z;
  vCorner = aPosition.xy;
  vLine = 0.0;
  // Outside the clip volume, so unused quads draw nothing
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);

  if (q < 0.5) {
    // The Music Box's grey line, from the centre to the right edge of the output
    if (uMode > 0.5) return;
    float halfPx = 0.5 * uPxPerUnit;
    vec2 centre = vec2(250.0) * uScale + uBias;
    float halfClip = (halfPx + 1.0) / uPxPerUnit * uScale.y;
    gl_Position = vec4(aPosition.x < 0.0 ? centre.x : 1.0, centre.y + aPosition.y * halfClip, 0.0, 1.0);
    vRadPx = halfPx;
    vColor = vec3(0.2);
    vLine = 1.0;
    return;
  }

  float i = q - 1.0;
  if (i >= uCount) return;

  vec2 c;
  float d;
  vec3 col;
  if (uMode < 0.5) musicBox(i, c, d, col);
  else if (uMode < 1.5) scope(i, c, d, col);
  else if (uMode < 2.5) arabesque(i, c, d, col);
  else if (uMode < 3.5) columnA(i, c, d, col);
  else columnBC(i, c, d, col);

  // Processing's ellipse() takes a diameter. The quad overhangs the disc by a
  // physical pixel so the antialiased edge isn't cut off.
  float radPx = 0.5 * d * uSize * uPxPerUnit;
  vec2 p = c + aPosition.xy * (radPx + 1.0) / uPxPerUnit;
  gl_Position = vec4(p * uScale + uBias, 0.0, 1.0);
  vRadPx = radPx;
  vColor = col;
}
`;

// Antialiased disc (or, for the line, band) with a one-pixel edge. Output is
// premultiplied, which is what p5's BLEND mode expects.
export const whitneyFrag = `
precision highp float;

varying vec2 vCorner;
varying float vRadPx;
varying vec3 vColor;
varying float vLine;

void main() {
  float dist = (vLine > 0.5 ? abs(vCorner.y) : length(vCorner)) * (vRadPx + 1.0);
  float cover = clamp(vRadPx + 0.5 - dist, 0.0, 1.0);
  if (cover <= 0.0) discard;
  gl_FragColor = vec4(vColor * cover, cover);
}
`;
