// The Latk module's shaders: segments of a point stream, drawn as plain lines.
// Twoscilloscope draws its beam with the same vertex shader.
//
// A point stream (see js/modules/latk/strokes.js) is packed one point per
// texel into uPoints: x and y in scope units (-1..1, +Y up), then the colour
// of the segment to the next point as 0xRRGGBB, or -1 for none. Segments go
// in batches of LATK_BATCH quads drawn from one p5.Geometry: aPosition.x is
// -1 at the segment's start and 1 at its end, aPosition.y is -1 or 1 across
// it, and aPosition.z is the quad's index in the batch.
//
// The quad is OsciMesh's from p5.twoscilloscope, which built six vertices a
// segment on the CPU and uploaded them every frame: it reaches uSize past both
// ends and to either side, and vUvl gives the fragment its place along and
// across the segment, and the segment's length, in scope units.
export const LATK_BATCH = 4096;

export const latkSegmentVert = `
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

// A solid line uHalfWidth either side of the segment, with round ends, so
// neighbouring segments join round. The edge is smoothed over uFeather (one
// physical pixel), premultiplied for p5's BLEND. Stands in for the p5 strokes
// of Twoscilloscope's example-latk.
export const latkLineFrag = `
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
