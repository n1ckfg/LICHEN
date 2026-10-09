// DepthAnything's output: the depth map, scaled up to the canvas and coloured.
// The map holds near as 1 and far as 0, normalized to the frame's own nearest
// and farthest points. Grey shows near as white, and Turbo runs from blue (far)
// to red (near). Invert swaps near and far first.
export const depthAnythingOutputFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;      // the depth map, in its red channel
uniform float uColormap;     // 0 Grey, 1 Turbo
uniform float uInvert;       // 1 swaps near and far

// Google's Turbo colormap, as depth-anything-v2-js approximates it
vec3 turbo(float x) {
  return clamp(vec3(
    0.13572138 + x * (4.61539260 + x * (-42.66032258 + x * (132.13108234 + x * (-152.94239396 + x * 59.28637943)))),
    0.09140261 + x * (2.19418839 + x * (4.84296658 + x * (-14.18503333 + x * (4.27729857 + x * 2.82956604)))),
    0.10667330 + x * (12.64194608 + x * (-60.58204836 + x * (110.36276771 + x * (-89.90310912 + x * 27.34824973))))
  ), 0.0, 1.0);
}

void main() {
  float d = texture2D(tex0, vTexCoord).r;
  if (uInvert > 0.5) d = 1.0 - d;
  gl_FragColor = vec4(uColormap > 0.5 ? turbo(d) : vec3(d), 1.0);
}
`;
