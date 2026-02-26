export const differentiatorFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform vec2 uResolution;
uniform float strength;

float luma(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

void main() {
  vec2 texel = 1.0 / uResolution;

  float tl = luma(texture2D(tex0, vTexCoord + vec2(-texel.x, -texel.y)).rgb);
  float t  = luma(texture2D(tex0, vTexCoord + vec2(0.0, -texel.y)).rgb);
  float tr = luma(texture2D(tex0, vTexCoord + vec2(texel.x, -texel.y)).rgb);
  float l  = luma(texture2D(tex0, vTexCoord + vec2(-texel.x, 0.0)).rgb);
  float r  = luma(texture2D(tex0, vTexCoord + vec2(texel.x, 0.0)).rgb);
  float bl = luma(texture2D(tex0, vTexCoord + vec2(-texel.x, texel.y)).rgb);
  float b  = luma(texture2D(tex0, vTexCoord + vec2(0.0, texel.y)).rgb);
  float br = luma(texture2D(tex0, vTexCoord + vec2(texel.x, texel.y)).rgb);

  float gx = -tl - 2.0*l - bl + tr + 2.0*r + br;
  float gy = -tl - 2.0*t - tr + bl + 2.0*b + br;
  float edge = sqrt(gx*gx + gy*gy) * strength;
  edge = clamp(edge, 0.0, 1.0);

  gl_FragColor = vec4(edge, edge, edge, 1.0);
}
`;
