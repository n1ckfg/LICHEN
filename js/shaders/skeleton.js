// Skeleton's mask: the input shrunk to the tracer's grid, one texel per cell,
// white where the shape is. A cell is white if at least Fill of an 8 x 8 grid
// of taps across it pass the threshold, and at least one does. At Fill 0, any
// one tap will do: averaging would lose a line thinner than a cell (an Edges
// outline, say), and the tracer thins whatever this widens. Raising Fill drops
// specks that cover only part of a cell, and at 1 a cell must be covered.
export const skeletonMaskFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform vec2 uStep;          // one cell, in uv
uniform float uThreshold;
uniform float uInvert;       // 1 traces dark shapes on a light ground
uniform float uFill;         // the share of taps that must pass

void main() {
  float taps = 0.0;
  for (int j = 0; j < 8; j++) {
    for (int i = 0; i < 8; i++) {
      vec2 o = (vec2(float(i), float(j)) + 0.5) / 8.0 - 0.5;
      float l = dot(texture2D(tex0, vTexCoord + o * uStep).rgb, vec3(0.299, 0.587, 0.114));
      l = mix(l, 1.0 - l, uInvert);
      if (l > uThreshold) taps += 1.0;
    }
  }
  float lit = taps > 0.0 && taps >= uFill * 64.0 ? 1.0 : 0.0;
  gl_FragColor = vec4(vec3(lit), 1.0);
}
`;
