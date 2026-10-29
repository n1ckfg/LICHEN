export const transformFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform vec2 uResolution;  // the frame in pixels
uniform vec2 uOffset;      // the picture's centre from the frame's, in pixels
uniform float uRotation;   // degrees, clockwise
uniform vec2 uScale;

void main() {
  // vTexCoord runs top-down inside a framebuffer, so +y is down
  vec2 p = vTexCoord * uResolution - (0.5 * uResolution + uOffset);

  // Undo the rotation, then the scale
  float a = radians(uRotation);
  float c = cos(a);
  float s = sin(a);
  p = vec2(c * p.x + s * p.y, -s * p.x + c * p.y);
  if (abs(uScale.x) < 1e-6 || abs(uScale.y) < 1e-6) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec2 uv = (p / uScale + 0.5 * uResolution) / uResolution;

  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  gl_FragColor = texture2D(tex0, uv);
}
`;
