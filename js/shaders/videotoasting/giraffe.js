export const giraffeFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform float uTime;
uniform sampler2D texA; // Source 1 (outgoing)
uniform sampler2D texB; // Source 2 (incoming)

void main() {
  // GIRAFFE: Multi-color smooth-edged animated wipe with anti-aliased edges
  vec2 uv = vTexCoord;

  // Giraffe moves across screen
  float t = mod(uTime, 2.0);
  float movePos = t * 1.5 - 0.25;

  // Simplified giraffe shape
  float x = uv.x - movePos;
  float y = uv.y - 0.5;

  // Body
  float body = length(vec2(x + 0.1, y)) - 0.15;
  // Neck
  float neck = length(vec2(x + 0.05, y + 0.2)) - 0.08;
  // Head
  float head = length(vec2(x, y + 0.35)) - 0.06;

  float shape = min(body, min(neck, head));

  // Smooth anti-aliased edge
  float edgeWidth = 0.03;
  float smoothEdge = 1.0 - smoothstep(-edgeWidth, edgeWidth, shape);

  // Multi-color palette
  vec3 color1 = texture2D(texA, uv).rgb; // Source 1
  vec3 giraffeColor = texture2D(texB, uv).rgb; // Giraffe (source 2)

  // Mix based on fader level
  vec3 finalColor = mix(color1, giraffeColor, smoothEdge);

  gl_FragColor = vec4(finalColor, 1.0);
}
`;
