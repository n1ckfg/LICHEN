export const cropFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform vec2 uResolution;  // the frame in pixels
uniform vec2 uCorner;      // the box's top-left, in pixels
uniform vec2 uSize;        // the box's width and height, in pixels

void main() {
  // vTexCoord runs top-down inside a framebuffer, so +y is down
  vec2 p = vTexCoord * uResolution;
  // A typed negative size runs the box the other way from the corner
  vec2 lo = min(uCorner, uCorner + uSize);
  vec2 hi = max(uCorner, uCorner + uSize);

  if (p.x < lo.x || p.x >= hi.x || p.y < lo.y || p.y >= hi.y) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  gl_FragColor = texture2D(tex0, vTexCoord);
}
`;
