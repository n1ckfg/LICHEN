// Twoscilloscope's shaders: OsciMesh's beam, redone for p5, and a plain line.
//
// Both draw segments of a point stream (see LatkScopeRenderer.js), packed one
// point per texel into uPoints: x and y in scope units (-1..1, +Y up), then
// the colour of the segment to the next point as 0xRRGGBB, or -1 for none.
// Segments go in batches of TWO_BATCH quads drawn from one p5.Geometry:
// aPosition.x is -1 at the segment's start and 1 at its end, aPosition.y is
// -1 or 1 across it, and aPosition.z is the quad's index in the batch.
//
// OsciMesh built six vertices a segment on the CPU and uploaded them every
// frame. The quad here is the same one: it reaches uSize past both ends and to
// either side, and vUvl gives the fragment its place along and across the
// segment, and the segment's length, in scope units.
export const TWO_BATCH = 4096;

export const twoscilloscopeVert = `
precision highp float;
attribute vec3 aPosition;

uniform sampler2D uPoints;
uniform vec2 uTexSize;
uniform float uBase;     // the point quad 0 starts at
uniform float uLast;     // the last point; no segment starts there
uniform float uAspect;   // width / height
uniform float uSize;     // how far the quad reaches, in scope units

varying vec3 vUvl;
varying vec3 vRgb;

vec4 point(float i) {
  float row = floor(i / uTexSize.x);
  return texture2D(uPoints, (vec2(i - row * uTexSize.x, row) + 0.5) / uTexSize);
}

void main() {
  float i = uBase + aPosition.z;
  vec4 a = point(min(i, uLast));
  if (i >= uLast || a.z < 0.0) {
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);   // no segment here: off screen
    return;
  }
  vec4 b = point(i + 1.0);

  // As far across as the frame's shape allows, so the beam stays round
  vec2 p0 = vec2(a.x * uAspect, a.y);
  vec2 p1 = vec2(b.x * uAspect, b.y);
  float len = length(p1 - p0);
  vec2 dir = len > 1e-6 ? (p1 - p0) / len : vec2(1.0, 0.0);
  vec2 norm = vec2(-dir.y, dir.x);
  bool atEnd = aPosition.x > 0.0;
  vec2 pos = (atEnd ? p1 : p0) + (dir * aPosition.x + norm * aPosition.y) * uSize;
  vUvl = vec3(atEnd ? len + uSize : -uSize, aPosition.y * uSize, len);

  // 0xRRGGBB, split with powers of two so it stays exact
  float r = floor(a.z / 65536.0);
  float g = floor((a.z - r * 65536.0) / 256.0);
  vRgb = vec3(r, g, a.z - r * 65536.0 - g * 256.0) / 255.0;

  // Scope +Y is up, and gl_FragCoord.y = 0 is the top of a framebuffer
  gl_Position = vec4(pos.x / uAspect, -pos.y, 0.0, 1.0);
}
`;

// The beam: the light a gaussian spot leaves as it sweeps along one segment,
// integrated analytically with erf (after m1el's woscope). Unchanged from
// p5.twoscilloscope's BEAM_FUNCTIONS, apart from the colour, which comes per
// segment instead of per mesh, and the brightness, which is always 1 here.
// Drawn with blendMode(ADD), as OsciMesh drew with (SRC_ALPHA, ONE).
export const twoscilloscopeBeamFrag = `
precision highp float;
uniform float uSize;
uniform float uIntensity;
varying vec3 vUvl;
varying vec3 vRgb;

#define SQRT2 1.4142135623730951
#define TAUR 2.5066282746310002

// approximates the error function, needed for the gaussian integral
float erfApprox(float x) {
  float s = sign(x), a = abs(x);
  x = 1.0 + (0.278393 + (0.230389 + 0.000972 * a + 0.078108 * a * a) * a) * a;
  x *= x;
  return s - s / (x * x);
}

void main() {
  float len = vUvl.z;
  vec2 xy = vUvl.xy;
  float sigma = uSize / 3.0;
  float b;
  if (len < 1E-6) {
    // too short to integrate, the intensity at the position
    b = exp(-dot(xy, xy) / (2.0 * sigma * sigma));
  } else {
    b = erfApprox(xy.x / SQRT2 / sigma) - erfApprox((xy.x - len) / SQRT2 / sigma);
    b *= exp(-xy.y * xy.y / (2.0 * sigma * sigma)) * sigma * TAUR / (2.0 * len);
  }
  b *= uIntensity;
  // where the beam is brightest it burns towards white
  vec3 col = vRgb * b + vec3(max(b - 1.0, 0.0) * 0.35);
  gl_FragColor = vec4(col, 1.0);
}
`;

// A solid line uHalfWidth either side of the segment, with round ends, so
// neighbouring segments join round. The edge is smoothed over uFeather (one
// physical pixel), premultiplied for p5's BLEND. Stands in for the example's
// p5 strokes.
export const twoscilloscopeLineFrag = `
precision highp float;
uniform float uHalfWidth;
uniform float uFeather;
varying vec3 vUvl;
varying vec3 vRgb;

void main() {
  float u = vUvl.x, len = vUvl.z;
  float d = u < 0.0 ? length(vUvl.xy) : u > len ? length(vec2(u - len, vUvl.y)) : abs(vUvl.y);
  float a = clamp((uHalfWidth - d) / uFeather + 0.5, 0.0, 1.0);
  gl_FragColor = vec4(vRgb * a, a);
}
`;
