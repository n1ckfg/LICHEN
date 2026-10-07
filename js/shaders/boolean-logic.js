export const booleanLogicFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform float time;
uniform float speed;
uniform float intensity;
uniform float op;
uniform float scale;
uniform float driftX;
uniform float driftY;
uniform float driftXY;

// Bit by bit, as GLSL ES 1.0 has no integer bitwise ops. op picks the
// operator: 0 XOR, 1 XNOR, 2 AND, 3 NAND, 4 OR, 5 NOR. Each odd op is the
// even one before it, inverted.
float bitwiseOp(float a, float b) {
  float res = 0.0;
  float p = 1.0;
  for(int i = 0; i < 8; i++) {
    float bitA = mod(floor(a / p), 2.0);
    float bitB = mod(floor(b / p), 2.0);
    float bit;
    if (op < 1.5) bit = abs(bitA - bitB);
    else if (op < 3.5) bit = bitA * bitB;
    else bit = max(bitA, bitB);
    res += bit * p;
    p *= 2.0;
  }
  if (mod(floor(op + 0.5), 2.0) > 0.5) res = 255.0 - res;
  return res;
}

void main() {
  vec2 uv = vTexCoord;
  vec4 color = texture2D(tex0, uv);

  float r = floor(color.r * 255.0);
  float g = floor(color.g * 255.0);
  float b = floor(color.b * 255.0);

  float patternX = mod(uv.x * 255.0 * scale + time * speed * driftX, 255.0);
  float patternY = mod(uv.y * 255.0 * scale + time * speed * driftY, 255.0);
  float patternXY = mod((uv.x + uv.y) * 255.0 * scale + time * speed * driftXY, 255.0);

  float xr = bitwiseOp(r, patternX);
  float xg = bitwiseOp(g, patternY);
  float xb = bitwiseOp(b, patternXY);

  vec3 logicColor = vec3(xr / 255.0, xg / 255.0, xb / 255.0);
  vec3 finalColor = mix(color.rgb, logicColor, intensity);

  gl_FragColor = vec4(finalColor, 1.0);
}
`;
