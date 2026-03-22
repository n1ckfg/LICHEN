export const levelsFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform float blackLevel;
uniform float whiteLevel;
uniform float gamma;

void main() {
  vec4 col = texture2D(tex0, vTexCoord);
  vec3 rgb = col.rgb;

  // Remap black and white levels
  rgb = (rgb - blackLevel) / (whiteLevel - blackLevel);

  // Apply gamma
  rgb = pow(clamp(rgb, 0.0, 1.0), vec3(1.0 / gamma));

  gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), col.a);
}
`;
