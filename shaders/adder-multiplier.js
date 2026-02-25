export const adderMultiplierFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform sampler2D tex1;
uniform float mode;
uniform float mixVal;
uniform float contrast;

void main() {
  vec4 c0 = texture2D(tex0, vTexCoord);
  vec4 c1 = texture2D(tex1, vTexCoord);
  vec3 a = c0.rgb;
  vec3 b = c1.rgb;
  vec3 result;

  if (mode < 0.5) {
    result = a + b;
  } else if (mode < 1.5) {
    result = a * b;
  } else if (mode < 2.5) {
    result = abs(a - b);
  } else {
    result = 1.0 - (1.0 - a) * (1.0 - b);
  }

  result = mix(a, result, mixVal);
  result = (result - 0.5) * contrast + 0.5;
  result = clamp(result, 0.0, 1.0);
  gl_FragColor = vec4(result, 1.0);
}
`;
