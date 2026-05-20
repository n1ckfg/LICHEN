export const conwaySimulationFrag = `
precision highp float;
uniform sampler2D u_state;
uniform vec2 u_resolution;
uniform float u_spawn;
uniform vec2 u_spawnPos;
uniform float u_spawnRadius;
uniform float u_spawnValue;
uniform float u_clear;
uniform float u_randomize;
uniform float u_time;

float random(vec2 st) {
  return fract(sin(dot(st, vec2(12.9898, 78.233))) * 43758.5453123);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 texel = 1.0 / u_resolution;

  if (u_clear > 0.5) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  if (u_randomize > 0.5) {
    float r = random(uv + vec2(u_time));
    float alive = r < 0.3 ? 1.0 : 0.0;
    gl_FragColor = vec4(alive, alive, alive, 1.0);
    return;
  }

  float current = texture2D(u_state, uv).r > 0.5 ? 1.0 : 0.0;

  int neighbors = 0;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      if (dx == 0 && dy == 0) continue;
      vec2 nUV = uv + vec2(float(dx), float(dy)) * texel;
      nUV = fract(nUV);
      if (texture2D(u_state, nUV).r > 0.5) neighbors++;
    }
  }

  float next = 0.0;
  if (current > 0.5) {
    if (neighbors == 2 || neighbors == 3) next = 1.0;
  } else {
    if (neighbors == 3) next = 1.0;
  }

  if (u_spawn > 0.5) {
    float dist = length(gl_FragCoord.xy - u_spawnPos);
    if (dist < u_spawnRadius) {
      next = u_spawnValue;
    }
  }

  gl_FragColor = vec4(next, next, next, 1.0);
}
`;

export const conwayRenderFrag = `
precision highp float;
uniform sampler2D u_state;
uniform vec2 u_resolution;
uniform float u_cellSize;
uniform vec3 u_deadColor;
uniform vec3 u_aliveColor;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;

  // Pixelate based on cell size
  vec2 cell = floor(gl_FragCoord.xy / u_cellSize);
  vec2 cellUV = (cell * u_cellSize + u_cellSize * 0.5) / u_resolution;

  float alive = texture2D(u_state, cellUV).r;
  vec3 color = mix(u_deadColor, u_aliveColor, alive);
  gl_FragColor = vec4(color, 1.0);
}
`;
