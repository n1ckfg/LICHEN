// Panorama views its input as a panorama from the centre: each output pixel
// casts a ray from a camera turned by yaw and pitch, and the input is read
// where that ray meets the sphere or cube it is mapped on. Both projections
// place the image as QTVR does (js/modules/QTVRModule.js), so a picture looks
// the same in either module at the same Yaw, Pitch and FOV.
//
// Directions are in p5's world space, as QTVR's camera sees them: y down, and
// at yaw 0 and pitch 0 the view looks toward -z with +x on the right.

const VIEW_RAY = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform vec2 uTexSize;   // the input in physical pixels
uniform float uYaw;      // radians; positive turns right
uniform float uPitch;    // radians; positive looks up
uniform float uTanHalf;  // tan(vertical FOV / 2)
uniform float uAspect;   // output width / height

// The ray through this pixel. vTexCoord runs top-down, as the y-down world does,
// so a pixel below the centre looks down.
vec3 viewRay() {
  float cp = cos(uPitch);
  vec3 f = vec3(sin(uYaw) * cp, -sin(uPitch), -cos(uYaw) * cp);
  // p5's camera() basis with up (0, 1, 0): x = up × z and y = z × x, z = -f
  vec3 x = normalize(cross(vec3(0.0, 1.0, 0.0), -f));
  vec3 y = cross(-f, x);
  vec2 s = vTexCoord * 2.0 - 1.0;
  return normalize(f + s.x * uTanHalf * uAspect * x + s.y * uTanHalf * y);
}
`;

// QTVR's sphere: p5's sphere() puts uv (u, v) at (cos φ sin θ, sin φ, cos φ cos θ),
// θ = 2πu and φ = πv − π/2, and QTVR mirrors x then turns it a quarter about y,
// which takes it to (cos φ cos θ, sin φ, cos φ sin θ). This inverts that.
export const panoramaEquirectFrag = VIEW_RAY + `
const float PI = 3.14159265358979;

// The input at column x (texels, wrapping round) and height v. Each tap sits on
// a column's centre, so the hardware blends rows only, and the two columns are
// blended here: the seam at θ = ±π blends the first column with the last instead
// of clamping to one of them.
vec4 column(float x, float v) {
  return texture2D(tex0, vec2((mod(x, uTexSize.x) + 0.5) / uTexSize.x, v));
}

void main() {
  vec3 d = viewRay();
  float u = atan(d.z, d.x) / (2.0 * PI);
  float v = asin(clamp(d.y, -1.0, 1.0)) / PI + 0.5;
  float x = fract(u) * uTexSize.x - 0.5;
  float x0 = floor(x);
  gl_FragColor = mix(column(x0, v), column(x0 + 1.0, v), x - x0);
}
`;

// QTVR's cube: a horizontal strip of six square faces, px, nx, py, ny, pz, nz
// left to right, each drawn on the cube face whose corners its top-left,
// top-right and bottom-left go to (QTVR's SKYBOX_FACES). Those corners are
// c0, c1 and c3 here, on the cube of side 2.
export const panoramaCubemapFrag = VIEW_RAY + `
void main() {
  vec3 d = viewRay();
  vec3 a = abs(d);
  float face;
  vec3 c0, c1, c3;
  if (a.x >= a.y && a.x >= a.z) {
    if (d.x > 0.0) { face = 0.0; c0 = vec3( 1.0, -1.0, -1.0); c1 = vec3( 1.0, -1.0,  1.0); c3 = vec3( 1.0,  1.0, -1.0); }
    else           { face = 1.0; c0 = vec3(-1.0, -1.0,  1.0); c1 = vec3(-1.0, -1.0, -1.0); c3 = vec3(-1.0,  1.0,  1.0); }
  } else if (a.y >= a.z) {
    if (d.y < 0.0) { face = 2.0; c0 = vec3(-1.0, -1.0,  1.0); c1 = vec3( 1.0, -1.0,  1.0); c3 = vec3(-1.0, -1.0, -1.0); }
    else           { face = 3.0; c0 = vec3(-1.0,  1.0, -1.0); c1 = vec3( 1.0,  1.0, -1.0); c3 = vec3(-1.0,  1.0,  1.0); }
  } else {
    if (d.z < 0.0) { face = 4.0; c0 = vec3(-1.0, -1.0, -1.0); c1 = vec3( 1.0, -1.0, -1.0); c3 = vec3(-1.0,  1.0, -1.0); }
    else           { face = 5.0; c0 = vec3( 1.0, -1.0,  1.0); c1 = vec3(-1.0, -1.0,  1.0); c3 = vec3( 1.0,  1.0,  1.0); }
  }
  // Where the ray meets the face, as uv across it (each edge is 2 long)
  vec3 p = d / max(max(a.x, a.y), a.z);
  vec2 uv = vec2(dot(p - c0, c1 - c0), dot(p - c0, c3 - c0)) / 4.0;
  // Held half a texel inside the face, so its edge doesn't blend in the next face
  vec2 tile = vec2(uTexSize.x / 6.0, uTexSize.y);
  uv = clamp(uv, 0.5 / tile, 1.0 - 0.5 / tile);
  gl_FragColor = texture2D(tex0, vec2((face + uv.x) / 6.0, uv.y));
}
`;

// With d cabled, the panorama is a cloud of points instead, after the three.js
// viewer in KINECT/threejs_depth_eqr: each point sits on a ray from the centre,
// at a distance d gives, and takes its colour from the input where the ray
// meets it. The viewpoint can leave the centre (uEye), so near points move
// against far ones. Each point is a square of Point Size px, drawn as a quad
// from four vertices that share its centre: aNormal.xy says which corner each
// is, and the shader moves it there in clip space, so the square keeps its size
// at any distance, as gl_PointSize does.
//
// aPosition is the point's direction, of length 1, in the same world as the
// ray-cast shaders above, so with the eye at the centre every point lands on
// the pixel whose ray reads the same place. aTexCoord is where it reads.

// threejs_depth_eqr's getDepthSpherical() and the testing constants it ran
// with: distance = Displacement x -clamp(asin(baseline x sin(angle)) / asin(d),
// -Maximum, 0). Brighter is nearer, as DepthAnything's Grey is. Depth is
// Displacement, and asin(baseline x sin(angle)) is worked out here in double
// precision, since sin(3.143) is a small difference near pi
const SPHERICAL_BASELINE = 180.0;
const SPHERICAL_ANGLE = 3.143;
const SPHERICAL_MAXIMUM = 30.0;
const SPHERICAL_K = -Math.asin(SPHERICAL_BASELINE * Math.sin(SPHERICAL_ANGLE));
const glslFloat = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));

// The clip space p5's framebuffer camera gives: y = -1 is the top of the
// output, as vTexCoord's v = 0 is in the ray-cast shaders
export const PANORAMA_NEAR = 0.1;
export const PANORAMA_FAR = 2000.0;

// cubemap: aTexCoord is the uv across the point's face, and aNormal.z the face,
// 0-5 along the strip. Each read is held half a texel inside the face, as the
// ray-cast cubemap's is
export const panoramaDepthVert = (cubemap) => `
precision highp float;
attribute vec3 aPosition;   // the point's direction, of length 1
attribute vec2 aTexCoord;   // where it reads the input and d${cubemap ? ', across its face' : ''}
attribute vec3 aNormal;     // its quad's corner, x and y in -1 or 1${cubemap ? ', and z its face' : ''}
uniform sampler2D tex0;     // the input, which colours the points
uniform sampler2D uDepthTex; // d, whose red channel places them
${cubemap ? `uniform vec2 uTexSize;     // the input in physical pixels
uniform vec2 uDepthSize;   // d in physical pixels
` : ''}uniform vec3 uEye;         // the viewpoint, in world units
uniform float uYaw;         // radians; positive turns right
uniform float uPitch;       // radians; positive looks up
uniform float uTanHalf;     // tan(vertical FOV / 2)
uniform float uAspect;      // output width / height
uniform float uDepth;       // Displacement: world units per unit of distance
uniform vec2 uPointScale;   // half a point, in clip units at w = 1
varying vec3 vColor;

const float K = ${SPHERICAL_K};
const float MAXIMUM = ${glslFloat(SPHERICAL_MAXIMUM)};
const float NEAR = ${glslFloat(PANORAMA_NEAR)};
const float FAR = ${glslFloat(PANORAMA_FAR)};

${cubemap ? `// uv across a face, held half a texel inside it, to the strip's uv
vec2 strip(vec2 uv, vec2 size) {
  vec2 tile = vec2(size.x / 6.0, size.y);
  uv = clamp(uv, 0.5 / tile, 1.0 - 0.5 / tile);
  return vec2((aNormal.z + uv.x) / 6.0, uv.y);
}

` : ''}// threejs_depth_eqr's saturation(), which it gave the points at 1.5
vec3 saturation(vec3 rgb, float adjustment) {
  const vec3 W = vec3(0.2125, 0.7154, 0.0721);
  vec3 intensity = vec3(dot(rgb, W));
  return mix(intensity, rgb, adjustment);
}

void main() {
  ${cubemap ? `vec4 col = texture2D(tex0, strip(aTexCoord, uTexSize));
  float d = texture2D(uDepthTex, strip(aTexCoord, uDepthSize)).r;` : `vec4 col = texture2D(tex0, aTexCoord);
  float d = texture2D(uDepthTex, aTexCoord).r;`}
  vColor = saturation(col.rgb, 1.5);

  // getDepthSpherical(), clamped to Maximum. d = 0 would divide by zero, and
  // goes to Maximum, as its limit does. A float d past 1 is held at 1
  float dist = uDepth * min(K / asin(clamp(d, 1e-4, 1.0)), MAXIMUM);
  vec3 rel = aPosition * dist - uEye;

  // The ray-cast shaders' camera basis: f ahead, x right, y down the screen
  float cp = cos(uPitch);
  vec3 f = vec3(sin(uYaw) * cp, -sin(uPitch), -cos(uYaw) * cp);
  vec3 x = normalize(cross(vec3(0.0, 1.0, 0.0), -f));
  vec3 y = cross(-f, x);
  float z = dot(rel, f);
  gl_Position = vec4(
    dot(rel, x) / (uTanHalf * uAspect) + aNormal.x * uPointScale.x * z,
    dot(rel, y) / uTanHalf + aNormal.y * uPointScale.y * z,
    (FAR + NEAR) / (FAR - NEAR) * z - 2.0 * FAR * NEAR / (FAR - NEAR),
    z);
}
`;

// threejs_depth_eqr's points are drawn at alpha 0.3, which Opacity sets here.
// p5's BLEND takes premultiplied colour
export const panoramaDepthFrag = `
precision highp float;
varying vec3 vColor;
uniform float uOpacity;

void main() {
  gl_FragColor = vec4(vColor * uOpacity, uOpacity);
}
`;
