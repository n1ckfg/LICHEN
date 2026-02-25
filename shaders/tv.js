export const tvFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform float time;
uniform float lineThickness;
uniform float lineDarkness;
uniform float flicker;
uniform vec2 uResolution;

void main() {
  vec3 col = texture2D(tex0, vTexCoord).rgb;
  float scanline = sin(vTexCoord.y * uResolution.y * lineThickness) * lineDarkness;
  float noise = sin(time * 100.0) * flicker;
  gl_FragColor = vec4(col + noise - scanline, 1.0);
}
`;
