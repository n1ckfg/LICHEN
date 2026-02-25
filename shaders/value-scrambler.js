export const valueScramblerFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform float levels;
uniform float scramble;

void main() {
  vec4 col = texture2D(tex0, vTexCoord);
  float luma = dot(col.rgb, vec3(0.299, 0.587, 0.114));
  float level = floor(luma * levels);
  float offset = floor(scramble * levels);
  level = mod(level + offset, levels);
  float val = level / (levels - 1.0);
  gl_FragColor = vec4(val, val, val, 1.0);
}
`;
