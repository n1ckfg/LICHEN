export const edgesFrag = `
precision mediump float;

uniform sampler2D tex0;
uniform vec2 texelSize;
uniform float mode;
uniform float threshold;

varying vec2 vTexCoord;

// The reference shaders sampled the red channel; LICHEN feeds arbitrary color
// video into this module, so every operator runs on luminance instead.
float lum(vec2 uv) {
  return dot(texture2D(tex0, uv).rgb, vec3(0.299, 0.587, 0.114));
}

// Sobel gradient, used by the refine-contour operator.
vec2 sobel(vec2 uv) {
  float tl = lum(uv + vec2(-texelSize.x, -texelSize.y));
  float tc = lum(uv + vec2(        0.0, -texelSize.y));
  float tr = lum(uv + vec2( texelSize.x, -texelSize.y));
  float ml = lum(uv + vec2(-texelSize.x,         0.0));
  float mr = lum(uv + vec2( texelSize.x,         0.0));
  float bl = lum(uv + vec2(-texelSize.x,  texelSize.y));
  float bc = lum(uv + vec2(        0.0,  texelSize.y));
  float br = lum(uv + vec2( texelSize.x,  texelSize.y));

  float gx = -tl + tr - 2.0 * ml + 2.0 * mr - bl + br;
  float gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;
  return vec2(gx, gy);
}

// Scharr kernels: better rotational symmetry than Sobel on diagonal edges.
vec2 scharr(vec2 uv) {
  float tl = lum(uv + vec2(-texelSize.x, -texelSize.y));
  float tc = lum(uv + vec2(        0.0, -texelSize.y));
  float tr = lum(uv + vec2( texelSize.x, -texelSize.y));
  float ml = lum(uv + vec2(-texelSize.x,         0.0));
  float mr = lum(uv + vec2( texelSize.x,         0.0));
  float bl = lum(uv + vec2(-texelSize.x,  texelSize.y));
  float bc = lum(uv + vec2(        0.0,  texelSize.y));
  float br = lum(uv + vec2( texelSize.x,  texelSize.y));

  float gx = -3.0 * tl + 3.0 * tr - 10.0 * ml + 10.0 * mr - 3.0 * bl + 3.0 * br;
  float gy = -3.0 * tl - 10.0 * tc - 3.0 * tr + 3.0 * bl + 10.0 * bc + 3.0 * br;
  return vec2(gx, gy);
}

// Discrete Laplacian standing in for the quantum-walk edge kernel (arXiv 1411.3958).
float quantumWalk(vec2 uv) {
  float c = lum(uv);
  float n = lum(uv + vec2(0.0,  texelSize.y));
  float s = lum(uv - vec2(0.0,  texelSize.y));
  float e = lum(uv + vec2(texelSize.x, 0.0));
  float w = lum(uv - vec2(texelSize.x, 0.0));
  return -4.0 * c + n + s + e + w;
}

void main() {
  vec2 uv = vTexCoord;
  int m = int(mode + 0.5);
  float edge;

  if (m == 1) {
    // Scharr: hard threshold on gradient magnitude
    edge = step(threshold, length(scharr(uv)));
  } else if (m == 2) {
    // Quantum walk: hard threshold on the Laplacian response
    edge = step(threshold, abs(quantumWalk(uv)));
  } else if (m == 3) {
    // Grayscale (debug): the luminance the operators above run on
    edge = lum(uv);
  } else {
    // Refine Contour: Sobel magnitude through a sigmoid for continuous lines
    float mag = length(sobel(uv));
    edge = 1.0 / (1.0 + exp(-10.0 * (mag - threshold)));
  }

  gl_FragColor = vec4(vec3(edge), 1.0);
}
`;
