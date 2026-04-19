export const slitscanFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D u_atlas;
uniform int u_frameOffset;
uniform int u_historySize;
uniform int u_cols;
uniform int u_rows;
uniform float u_x1;
uniform float u_y1;
uniform float u_axis;
uniform float u_mirror;

vec2 tileUV(int slot, vec2 local) {
  float s = float(slot);
  float c = float(u_cols);
  float r = float(u_rows);
  float col = mod(s, c);
  float row = floor(s / c);
  vec2 tileSize = vec2(1.0 / c, 1.0 / r);
  return (vec2(col, row) + local) * tileSize;
}

int wrapi(int a, int b) {
  float fa = float(a);
  float fb = float(b);
  return int(fa - fb * floor(fa / fb));
}

void main() {
  vec2 uv = mix(vTexCoord, vec2(1.0 - vTexCoord.x, vTexCoord.y), step(0.5, u_mirror));

  float histSize = float(u_historySize);
  float nStrips = 2.0 + u_x1 * (histSize - 2.0);
  int maxDelayPerStrip = int(histSize / nStrips);
  int delayPerStrip = int(1.0 + u_y1 * float(maxDelayPerStrip - 1));
  float axisCoord = mix(uv.y, uv.x, step(0.5, u_axis));
  int stripIndex = int(axisCoord * nStrips);
  int delay = stripIndex * delayPerStrip;

  int slot = wrapi(u_frameOffset - delay, u_historySize);
  gl_FragColor = texture2D(u_atlas, tileUV(slot, uv));
}
`;
