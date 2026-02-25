export const functionGeneratorFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform float curve;
uniform float gain;

void main() {
  vec4 col = texture2D(tex0, vTexCoord);
  vec3 x = col.rgb;
  vec3 result;

  if (curve < 0.5) {
    result = x;
  } else if (curve < 1.5) {
    result = x * x;
  } else if (curve < 2.5) {
    result = sqrt(x);
  } else if (curve < 3.5) {
    result = sin(x * 3.14159265);
  } else if (curve < 4.5) {
    result = abs(x * 2.0 - 1.0);
  } else {
    result = floor(x * 4.0) / 4.0;
  }

  result = clamp(result * gain, 0.0, 1.0);
  gl_FragColor = vec4(result, 1.0);
}
`;
