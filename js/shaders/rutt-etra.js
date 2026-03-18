// Rutt-Etra vertex shader - displaces vertices based on texture brightness
export const ruttEtraVert = `
precision highp float;

attribute vec3 aPosition;
attribute vec2 aTexCoord;

uniform mat4 uModelViewMatrix;
uniform mat4 uProjectionMatrix;

uniform sampler2D uInputTex;
uniform float uDepth;
uniform float uScale;
uniform float uRotationX;
uniform float uRotationY;

varying vec3 vColor;

// Rotation matrix around X axis
mat3 rotateX(float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return mat3(
    1.0, 0.0, 0.0,
    0.0, c, -s,
    0.0, s, c
  );
}

// Rotation matrix around Y axis
mat3 rotateY(float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return mat3(
    c, 0.0, s,
    0.0, 1.0, 0.0,
    -s, 0.0, c
  );
}

void main() {
  // Sample input texture at this vertex's UV coordinate
  vec4 texColor = texture2D(uInputTex, aTexCoord);

  // Calculate brightness using same formula as original
  float brightness = (0.34 * texColor.r + 0.5 * texColor.g + 0.16 * texColor.b);

  // Z displacement based on brightness
  float z = -brightness * uDepth + uDepth * 0.5;

  // Build displaced position
  vec3 pos = vec3(aPosition.xy, z);

  // Apply rotations
  pos = rotateX(uRotationX) * pos;
  pos = rotateY(uRotationY) * pos;

  // Apply scale
  pos *= uScale;

  // Pass color to fragment shader
  vColor = texColor.rgb;

  gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(pos, 1.0);
}
`;

// Rutt-Etra fragment shader - outputs vertex color with opacity
export const ruttEtraFrag = `
precision highp float;

varying vec3 vColor;
uniform float uOpacity;

void main() {
  gl_FragColor = vec4(vColor * uOpacity, 1.0);
}
`;
