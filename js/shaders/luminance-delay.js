export const luminanceDelayFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D u_atlas;
uniform int u_frameOffset;
uniform int u_historySize;
uniform int u_cols;
uniform int u_rows;
uniform int u_divisions;
uniform int u_framesPerDivision;
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

  int currentSlot = wrapi(u_frameOffset, u_historySize);
  vec4 current = texture2D(u_atlas, tileUV(currentSlot, uv));
  float lightness = dot(clamp(current.rgb, 0.0, 1.0), vec3(0.299, 0.587, 0.114));

  float divF = float(u_divisions);
  float signF = step(0.0, divF);
  int division = int(floor(abs((signF - lightness) * divF)));
  int delay = division * u_framesPerDivision;

  int slot = wrapi(u_frameOffset - delay, u_historySize);
  gl_FragColor = texture2D(u_atlas, tileUV(slot, uv));
}
`;
