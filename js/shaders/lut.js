// Applies a baked 3D LUT. The lattice is an atlas of blue slices, each
// uSize x uSize texels with red across and green down, uCols slices to a row.
// The texture's bilinear filtering interpolates red and green within a slice,
// and mixing the two neighbouring slices adds blue: trilinear in two fetches.
export const lutFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform sampler2D uLut;
uniform float uSize;
uniform float uCols;
uniform vec2 uAtlasSize;
uniform float uMix;

vec3 lutSlice(float b, vec2 rg) {
  float row = floor((b + 0.5) / uCols);   // +0.5 guards against b / uCols landing just under an integer
  float col = b - row * uCols;
  return texture2D(uLut, (vec2(col, row) * uSize + rg + 0.5) / uAtlasSize).rgb;
}

void main() {
  vec4 src = texture2D(tex0, vTexCoord);
  // Also the no-LUT-loaded case, where the lattice uniforms are unset: mixing
  // in their NaNs even at weight 0 would still give NaN
  if (uMix == 0.0) {
    gl_FragColor = src;
    return;
  }
  vec3 p = clamp(src.rgb, 0.0, 1.0) * (uSize - 1.0);
  float b0 = floor(p.b);
  float b1 = min(b0 + 1.0, uSize - 1.0);
  vec3 graded = mix(lutSlice(b0, p.rg), lutSlice(b1, p.rg), p.b - b0);
  gl_FragColor = vec4(mix(src.rgb, graded, uMix), src.a);
}
`;
