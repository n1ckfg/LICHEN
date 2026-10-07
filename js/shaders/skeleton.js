// Skeleton's mask: the input shrunk to the tracer's grid, one texel per cell,
// white where the shape is. A cell is white if any of an 8 x 8 grid of taps
// across it passes the threshold. Averaging would lose a line thinner than a
// cell (an Edges outline, say), and the tracer thins whatever this widens.
export const skeletonMaskFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform vec2 uStep;          // one cell, in uv
uniform float uThreshold;
uniform float uInvert;       // 1 traces dark shapes on a light ground

void main() {
  float lit = 0.0;
  for (int j = 0; j < 8; j++) {
    for (int i = 0; i < 8; i++) {
      vec2 o = (vec2(float(i), float(j)) + 0.5) / 8.0 - 0.5;
      float l = dot(texture2D(tex0, vTexCoord + o * uStep).rgb, vec3(0.299, 0.587, 0.114));
      l = mix(l, 1.0 - l, uInvert);
      if (l > uThreshold) lit = 1.0;
    }
  }
  gl_FragColor = vec4(vec3(lit), 1.0);
}
`;
