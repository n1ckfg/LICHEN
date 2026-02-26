export const gameboyFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform vec2 uResolution;

float getLuminance(vec3 col) {
  return dot(col, vec3(0.299, 0.587, 0.114));
}

float getDitherValue(int x, int y) {
  // 3x3 Bayer dither matrix
  if (x == 0 && y == 0) return 0.0;
  if (x == 1 && y == 0) return 0.5;
  if (x == 2 && y == 0) return 0.125;
  if (x == 0 && y == 1) return 0.75;
  if (x == 1 && y == 1) return 0.25;
  if (x == 2 && y == 1) return 0.875;
  if (x == 0 && y == 2) return 0.1875;
  if (x == 1 && y == 2) return 0.6875;
  if (x == 2 && y == 2) return 0.0625;
  return 0.0;
}

void main() {
  vec3 texColor = texture2D(tex0, vTexCoord).rgb;
  float texGray = getLuminance(texColor);

  int paletteIndex = int(texGray * 15.0);
  vec2 pixelCoord = vTexCoord * uResolution;
  int x = int(mod(pixelCoord.x, 3.0));
  int y = int(mod(pixelCoord.y, 3.0));
  float ditherVal = getDitherValue(x, y);
  int ditherIndex = int(ditherVal * 15.0);
  paletteIndex = min(paletteIndex + ditherIndex, 15);

  vec3 ditheredColor = vec3(
    float(paletteIndex / 4 - (paletteIndex / 8) * 2),
    float(paletteIndex / 2 - (paletteIndex / 4) * 2),
    float(paletteIndex - (paletteIndex / 2) * 2)
  );

  float texGray2 = texGray - 0.15 * getLuminance(ditheredColor);

  vec3 color;
  if (texGray2 <= 0.25) {
    color = vec3(0.066);
  } else if (texGray2 <= 0.5) {
    color = vec3(0.376);
  } else if (texGray2 <= 0.75) {
    color = vec3(0.686);
  } else {
    color = vec3(0.937);
  }

  gl_FragColor = vec4(color, 1.0);
}
`;
