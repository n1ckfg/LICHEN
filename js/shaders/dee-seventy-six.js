export const deeSeventySixFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform vec2 uResolution;
uniform float progress;
uniform float grainScale;
uniform float solarizeLimit;
uniform float frame;
uniform bool isColor;

// Basic hash function
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// Hash with channel and frame offset - varies each frame for accumulation
float hash3(vec2 p, float c) {
  return hash(p + vec2(c * 13.1 + frame * 0.1, c * 17.7 + frame * 0.07));
}

// 2D hash returning vec2 for Voronoi cell centers
vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}

// Voronoi cellular noise - returns cell ID and distance to edge
vec3 voronoi(vec2 x, float scale) {
  vec2 p = x * scale;
  vec2 ip = floor(p);
  vec2 fp = fract(p);

  float minDist = 1.0;
  vec2 minCell = vec2(0.0);

  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 neighbor = vec2(float(i), float(j));
      vec2 cellId = ip + neighbor;
      vec2 cellCenter = neighbor + hash2(cellId) - fp;
      float dist = length(cellCenter);

      if (dist < minDist) {
        minDist = dist;
        minCell = cellId;
      }
    }
  }

  return vec3(minCell, minDist);
}

// Sobel edge detection
float edgeDetection(vec2 uv, vec2 resolution) {
  vec2 offset = 1.0 / resolution;

  float t00 = dot(texture2D(tex0, uv + vec2(-offset.x, -offset.y)).rgb, vec3(0.299, 0.587, 0.114));
  float t10 = dot(texture2D(tex0, uv + vec2( 0.0,      -offset.y)).rgb, vec3(0.299, 0.587, 0.114));
  float t20 = dot(texture2D(tex0, uv + vec2( offset.x, -offset.y)).rgb, vec3(0.299, 0.587, 0.114));
  float t01 = dot(texture2D(tex0, uv + vec2(-offset.x,  0.0)).rgb, vec3(0.299, 0.587, 0.114));
  float t21 = dot(texture2D(tex0, uv + vec2( offset.x,  0.0)).rgb, vec3(0.299, 0.587, 0.114));
  float t02 = dot(texture2D(tex0, uv + vec2(-offset.x,  offset.y)).rgb, vec3(0.299, 0.587, 0.114));
  float t12 = dot(texture2D(tex0, uv + vec2( 0.0,       offset.y)).rgb, vec3(0.299, 0.587, 0.114));
  float t22 = dot(texture2D(tex0, uv + vec2( offset.x,  offset.y)).rgb, vec3(0.299, 0.587, 0.114));

  float sx = -1.0 * t00 - 2.0 * t01 - 1.0 * t02 + 1.0 * t20 + 2.0 * t21 + 1.0 * t22;
  float sy = -1.0 * t00 - 2.0 * t10 - 1.0 * t20 + 1.0 * t02 + 2.0 * t12 + 1.0 * t22;

  return sqrt(sx * sx + sy * sy);
}

void main() {
  vec2 uv = vTexCoord;
  vec2 pixelPos = floor(uv * uResolution);

  // Find edge strength at this pixel
  float edge = edgeDetection(uv, uResolution);

  // Disrupt Voronoi regularity near edges
  vec2 jitter = vec2(hash3(pixelPos, 10.0), hash3(pixelPos, 11.0)) * 2.0 - 1.0;
  vec2 voronoiUv = uv + jitter * edge * 0.02;
  float localGrainScale = grainScale + edge * 50.0;

  // Get Voronoi cell for this pixel
  vec3 cellInfo = voronoi(voronoiUv, localGrainScale);
  vec2 cellId = cellInfo.xy;

  // Grain properties derived from cell ID
  float grainRand = hash(cellId);
  float numCrystals = 15.0 + grainRand * 10.0;

  vec3 outColor = vec3(1.0); // White paper base

  if (isColor) {
    // Sample color at grain center
    vec2 grainCenter = (cellId + 0.5) / localGrainScale;
    vec3 grainColor = texture2D(tex0, clamp(grainCenter, 0.0, 1.0)).rgb;

    // Red channel -> Cyan dye
    float r_energy = 1.0 - grainColor.r;
    float r_processed = (r_energy * numCrystals < solarizeLimit) ? r_energy : 0.0;
    float r_crystalRand = hash3(pixelPos, 1.0);
    float r_reveal = hash3(cellId, 4.0);
    if (r_crystalRand < r_processed && r_reveal < progress) {
      outColor.r = 0.0;
    }

    // Green channel -> Magenta dye
    float g_energy = 1.0 - grainColor.g;
    float g_processed = (g_energy * numCrystals < solarizeLimit) ? g_energy : 0.0;
    float g_crystalRand = hash3(pixelPos, 2.0);
    float g_reveal = hash3(cellId, 5.0);
    if (g_crystalRand < g_processed && g_reveal < progress) {
      outColor.g = 0.0;
    }

    // Blue channel -> Yellow dye
    float b_energy = 1.0 - grainColor.b;
    float b_processed = (b_energy * numCrystals < solarizeLimit) ? b_energy : 0.0;
    float b_crystalRand = hash3(pixelPos, 3.0);
    float b_reveal = hash3(cellId, 6.0);
    if (b_crystalRand < b_processed && b_reveal < progress) {
      outColor.b = 0.0;
    }
  } else {
    // Black and white mode
    vec2 grainCenter = (cellId + 0.5) / localGrainScale;
    vec3 grainColor = texture2D(tex0, clamp(grainCenter, 0.0, 1.0)).rgb;
    float luma = dot(grainColor, vec3(0.299, 0.587, 0.114));

    float bw_energy = 1.0 - luma;
    float bw_processed = (bw_energy * numCrystals < solarizeLimit) ? bw_energy : 0.0;
    float crystalRand = hash3(pixelPos, 1.0);
    float reveal = hash3(cellId, 4.0);

    if (crystalRand < bw_processed && reveal < progress) {
      outColor = vec3(0.0);
    }
  }

  gl_FragColor = vec4(outColor, 1.0);
}
`;

export const deeSeventySixAccumFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;  // Current grain frame
uniform sampler2D tex1;  // Accumulated buffer
uniform float fadeAmount;

void main() {
  vec3 current = texture2D(tex0, vTexCoord).rgb;
  vec3 accum = texture2D(tex1, vTexCoord).rgb;

  // Fade accumulated towards white
  vec3 faded = mix(accum, vec3(1.0), fadeAmount);

  // Multiply blend: darkens over time like photographic paper
  vec3 result = faded * current;

  gl_FragColor = vec4(result, 1.0);
}
`;
