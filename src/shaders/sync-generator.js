export const syncGeneratorFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform float steps;
uniform float mode;

void main() {
  vec4 col = texture2D(tex0, vTexCoord);
  vec3 c = col.rgb;
  vec3 result;

  if (mode < 0.5) {
    result = floor(c * steps) / steps;
  } else if (mode < 1.5) {
    result = floor(c * steps + 0.5) / steps;
  } else {
    vec3 g = pow(c, vec3(0.8));
    result = floor(g * steps) / steps;
  }

  gl_FragColor = vec4(result, 1.0);
}
`;
