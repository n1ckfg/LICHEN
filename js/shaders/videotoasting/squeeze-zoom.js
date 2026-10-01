export const squeezeZoomFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform float uTime;
uniform sampler2D texA; // Source 1 (outgoing)
uniform sampler2D texB; // Source 2 (incoming)

void main() {
  // Squeeze/Zoom: uniform shrink/expand
  float t = mod(uTime, 2.0);
  float scale = 0.3 + sin(t * 3.14159) * 0.7; // 0.3 to 1.0

  vec2 center = vec2(0.5);
  vec2 uv = (vTexCoord - center) / scale + center;

  vec3 color;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    color = texture2D(texA, vTexCoord).rgb; // Outside (source 1)
  } else {
    color = texture2D(texB, uv).rgb; // Inside (source 2)
  }

  gl_FragColor = vec4(color, 1.0);
}
`;
