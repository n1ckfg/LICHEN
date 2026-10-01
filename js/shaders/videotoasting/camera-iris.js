export const cameraIrisFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform float uTime;
uniform sampler2D texA; // Source 1 (outgoing)
uniform sampler2D texB; // Source 2 (incoming)

#define NUM_BLADES 6

void main() {
  // CAMERA IRIS: 4-color expanding/contracting iris wipe
  vec2 uv = vTexCoord;

  // Distance from center
  float dist = length(uv - vec2(0.5));

  // Iris animation - close then open
  float t = mod(uTime, 2.0);
  float irisSize;

  if (t < 1.0) {
    irisSize = 1.0 - t;
  } else {
    irisSize = t - 1.0;
  }

  // Iris blades effect
  float angle = atan(uv.y - 0.5, uv.x - 0.5);
  float bladeAngle = mod(angle + 3.14159, 3.14159 * 2.0 / float(NUM_BLADES));
  float bladeWidth = 3.14159 * 2.0 / float(NUM_BLADES) * 0.8;
  float bladeEffect = 1.0 - smoothstep(bladeWidth * 0.5, bladeWidth, bladeAngle);

  // Determine which source to show
  vec3 color;
  if (dist < irisSize) {
    color = texture2D(texB, uv).rgb;
  } else {
    color = texture2D(texA, uv).rgb;
  }

  // Add blade shadows
  color *= 0.8 + 0.2 * bladeEffect;

  gl_FragColor = vec4(color, 1.0);
}
`;
