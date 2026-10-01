export const bearFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform float uTime;
uniform sampler2D texA; // Source 1 (outgoing)
uniform sampler2D texB; // Source 2 (incoming)

#define MATTE_COLOR vec3(0.0) // Toaster Matte generator (black)

void main() {
  // BEAR: 4-color wipe moving across screen with matte outline
  vec2 uv = vTexCoord;

  // Wipe moves across screen
  float t = mod(uTime, 2.0);
  float wipePos = t;

  // Bear shape outline (simplified as a moving shape)
  float shapeX = uv.x - wipePos;
  float shapeY = uv.y - 0.5;
  float dist = length(vec2(shapeX, shapeY));

  // Create bear-like outline with matte
  float matteWidth = 0.05;

  vec3 color;
  if (dist < 0.1 - matteWidth) {
    // Inside shape - source 2
    color = texture2D(texB, uv).rgb;
  } else if (dist < 0.1) {
    // Matte outline
    color = MATTE_COLOR;
  } else {
    // Outside - source 1
    color = texture2D(texA, uv).rgb;
  }

  gl_FragColor = vec4(color, 1.0);
}
`;
