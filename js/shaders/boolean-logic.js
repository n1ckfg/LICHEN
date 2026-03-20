export const booleanLogicFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform float time;
uniform float speed;
uniform float intensity;

float bitwiseXor(float a, float b) {
  float res = 0.0;
  float p = 1.0;
  for(int i = 0; i < 8; i++) {
    float bitA = mod(floor(a / p), 2.0);
    float bitB = mod(floor(b / p), 2.0);
    float bitXor = abs(bitA - bitB);
    res += bitXor * p;
    p *= 2.0;
  }
  return res;
}

void main() {
  vec2 uv = vTexCoord;
  vec4 color = texture2D(tex0, uv);

  float r = floor(color.r * 255.0);
  float g = floor(color.g * 255.0);
  float b = floor(color.b * 255.0);

  float patternX = mod(uv.x * 255.0 + time * speed * 50.0, 255.0);
  float patternY = mod(uv.y * 255.0 - time * speed * 30.0, 255.0);
  float patternXY = mod((uv.x + uv.y) * 255.0, 255.0);

  float xr = bitwiseXor(r, patternX);
  float xg = bitwiseXor(g, patternY);
  float xb = bitwiseXor(b, patternXY);

  vec3 xorColor = vec3(xr / 255.0, xg / 255.0, xb / 255.0);
  vec3 finalColor = mix(color.rgb, xorColor, intensity);

  gl_FragColor = vec4(finalColor, 1.0);
}
`;
