export const cropFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform vec2 uResolution;  // the frame in pixels
uniform vec2 uCorner;      // the box's top-left, in pixels
uniform vec2 uSize;        // the box's width and height, in pixels
uniform float uFit;        // 0: the box stays where it is, 1: it fills the frame

void main() {
  // vTexCoord runs top-down inside a framebuffer, so +y is down
  vec2 p = vTexCoord * uResolution;
  // A typed negative size runs the box the other way from the corner
  vec2 lo = min(uCorner, uCorner + uSize);
  vec2 hi = max(uCorner, uCorner + uSize);

  vec2 uv = vTexCoord;
  if (uFit > 0.5) {
    // The box stretched to the frame. Past the picture's edge is black, as
    // round a floating box
    uv = (lo + vTexCoord * (hi - lo)) / uResolution;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || hi.x - lo.x < 1e-3 || hi.y - lo.y < 1e-3) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }
  } else if (p.x < lo.x || p.x >= hi.x || p.y < lo.y || p.y >= hi.y) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  gl_FragColor = texture2D(tex0, uv);
}
`;
