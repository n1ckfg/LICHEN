// Inpainter fills the input's transparent areas from the colours round them.
// A pixel whose alpha is at least the threshold is known; the rest are holes.
// The fill is the membrane (harmonic) interpolant of the known colours, the
// solution of Laplace's equation with the known pixels fixed, which is what
// the Laplacian solver of jamriska and Ruofei Du (Shadertoy 4ty3Dy, after
// Jeschke et al. 09) converges to over many frames. Here it is solved every
// frame, coarse to fine, so moving holes don't smear:
//
//   inpainterSeedFrag    the input as known colour (unpremultiplied) and weight
//   inpainterPullFrag    halves the level below it, weighting by what's known
//   inpainterPushFrag    a level's known colour over the solved level above
//   inpainterSmoothFrag  one Jacobi step of Laplace's equation at a level
//   inpainterFrag        the input over the fill, or the mask
//
// The working buffers have density 1, and every pass but the first and last
// addresses them through gl_FragCoord, as one level's texel centres line up
// with the next's whatever their sizes. In every buffer, rgb is a colour and
// alpha is how much of it is known (1 known, 0 a hole).

export const inpainterSeedFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform float uThreshold;

void main() {
  vec4 src = texture2D(tex0, vTexCoord);
  // LICHEN's colours are premultiplied, so a known pixel's own colour is rgb / a
  float known = src.a > 0.0 && src.a >= uThreshold ? 1.0 : 0.0;
  vec3 col = clamp(src.rgb / max(src.a, 1e-4), 0.0, 1.0);
  gl_FragColor = vec4(col * known, known);
}
`;

export const inpainterPullFrag = `
precision highp float;
uniform sampler2D tex0;   // the finer level
uniform vec2 uFineSize;   // its size in texels

vec4 tap(vec2 p) {
  // A level of odd size has no second texel past its edge
  if (p.x >= uFineSize.x || p.y >= uFineSize.y) return vec4(0.0);
  vec4 s = texture2D(tex0, (p + 0.5) / uFineSize);
  return vec4(s.rgb * s.a, s.a);
}

void main() {
  vec2 p = floor(gl_FragCoord.xy) * 2.0;
  vec4 sum = tap(p) + tap(p + vec2(1.0, 0.0)) + tap(p + vec2(0.0, 1.0)) + tap(p + vec2(1.0, 1.0));
  // Gortler et al.'s pull: anything known in the four makes the texel known
  gl_FragColor = sum.a > 0.0 ? vec4(sum.rgb / sum.a, min(sum.a, 1.0)) : vec4(0.0);
}
`;

export const inpainterPushFrag = `
precision highp float;
uniform sampler2D tex0;    // this level, pulled
uniform sampler2D tex1;    // the level above, solved
uniform vec2 uSize;        // this level's size in texels
uniform vec2 uCoarseSize;  // the level above's
uniform float uHasCoarse;  // 0 at the top level

void main() {
  vec4 p = texture2D(tex0, gl_FragCoord.xy / uSize);
  // Texel i above is centred on texel 2i + 1 here, so the level above is read
  // bilinearly at half this texel's coordinate
  vec3 up = uHasCoarse > 0.5 ? texture2D(tex1, gl_FragCoord.xy / (2.0 * uCoarseSize)).rgb : p.rgb;
  gl_FragColor = vec4(mix(up, p.rgb, p.a), 1.0);
}
`;

export const inpainterSmoothFrag = `
precision highp float;
uniform sampler2D tex0;  // this level, pulled
uniform sampler2D tex1;  // this level, solved so far
uniform vec2 uSize;      // its size in texels

void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  vec2 t = 1.0 / uSize;
  vec4 p = texture2D(tex0, uv);
  // Past the frame's edge the read clamps to the edge texel, so the fill
  // meets the edge square on
  vec3 avg = 0.25 * (
    texture2D(tex1, uv + vec2(t.x, 0.0)).rgb + texture2D(tex1, uv - vec2(t.x, 0.0)).rgb +
    texture2D(tex1, uv + vec2(0.0, t.y)).rgb + texture2D(tex1, uv - vec2(0.0, t.y)).rgb);
  gl_FragColor = vec4(mix(avg, p.rgb, p.a), 1.0);
}
`;

export const inpainterFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;  // the input
uniform sampler2D tex1;  // the solved fill, full size
uniform float uThreshold;
uniform float uView;     // 0 inpainted, 1 the mask

void main() {
  vec4 src = texture2D(tex0, vTexCoord);
  if (uView > 0.5) {
    // White where the input is known, black where it is filled
    float known = src.a > 0.0 && src.a >= uThreshold ? 1.0 : 0.0;
    gl_FragColor = vec4(vec3(known), 1.0);
    return;
  }
  // The input over the fill: a known pixel's fill is its own colour, so it
  // comes back unchanged, and a hole's soft edge fades into the fill
  vec3 fill = texture2D(tex1, vTexCoord).rgb;
  gl_FragColor = vec4(clamp(src.rgb + (1.0 - src.a) * fill, 0.0, 1.0), 1.0);
}
`;
